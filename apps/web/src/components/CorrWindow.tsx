/**
 * Panneau « CORR » — matrice de corrélation, dockable à droite, NON MODAL (pas d'overlay).
 *
 * Suit le pattern DerivativesWindow : panneau translaté hors écran quand fermé (inerte,
 * pointer-events-none), toggle par le mnémonique CORR ou une commande de la palette. Le
 * graphe reste interactif pendant l'analyse.
 *
 * Contenu :
 *  - matrice N×N (canvas) sur les symboles de la WATCHLIST (+ ajout ponctuel), dégradé
 *    down→up entre -1 et +1, valeur au survol ;
 *  - clic sur une cellule = mini-détail : corrélation glissante 30 j en sparkline (canvas) ;
 *  - bascule Pearson / Spearman, fenêtre 30/90/180 j, bouton « recalculer » (re-fetch forcé),
 *    indication de fraîcheur.
 *
 * Données : klines 1d des adaptateurs existants (aucune source nouvelle), en CACHE session
 * (réouvrir ≠ refetch). La corrélation n'est PAS haute fréquence (données journalières,
 * calcul ponctuel) : l'état peut vivre dans React ; seul le dessin passe par le canvas.
 * Dégradation gracieuse : une source en panne laisse ses cellules vides, sans erreur en boucle.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { Commande } from "../commands/registry";
import { watchlistStore } from "../store/watchlist";
import { QUOTE_ASSETS } from "../data/symbol";
import {
  alignerSeries,
  calculerMatrice,
  chargerSeries,
  correlationGlissante,
  logRendements,
  viderCacheSeries,
  type MatriceCorr,
  type MethodeCorr,
  type SerieCloture,
} from "../data/corr";

// ─────────────────────────── Store UI (vanilla, éphémère) ───────────────────────────

/**
 * Store d'ouverture du panneau CORR — Zustand VANILLA (hors render-loop React). Défini ici
 * (et non dans un fichier store dédié) pour tenir le périmètre strict de la mission à trois
 * fichiers. Éphémère : NON persisté.
 */
export interface CorrUiState {
  open: boolean;
  openCorr: () => void;
  closeCorr: () => void;
  toggleCorr: () => void;
}

export const corrUiStore = createStore<CorrUiState>((set, get) => ({
  open: false,
  openCorr: () => set({ open: true }),
  closeCorr: () => set({ open: false }),
  toggleCorr: () => set({ open: !get().open }),
}));

/**
 * Commandes exposées à la palette (l'intégrateur les enregistre via `enregistrerCommandes`).
 * Le toggle pilote le store vanilla → appelable palette / raccourci indifféremment.
 */
export const commandes: Commande[] = [
  {
    id: "panneau:corr",
    mnemonique: "CORR",
    libelle: "Corrélations",
    categorie: "panneau",
    motsCles: ["correlation", "corr", "pearson", "spearman", "matrice", "diversification", "hedge"],
    apercu: "Ouvre / ferme la matrice de corrélation",
    action: () => corrUiStore.getState().toggleCorr(),
  },
];

// ─────────────────────────── Helpers couleur / libellé (purs) ───────────────────────────

/** Lit une variable CSS de thème sur <html> (ex. « --up »). */
function lireVar(nom: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(nom).trim();
}

/** Convertit un hex (#rgb ou #rrggbb) en triplet RGB, ou null si non hex. */
function hexRgb(hex: string): [number, number, number] | null {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Interpole linéairement deux couleurs RGB (t ∈ [0,1]). */
function melanger(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

/** Chaîne CSS d'un triplet RGB. */
function rgbCss([r, g, b]: [number, number, number]): string {
  return `rgb(${r},${g},${b})`;
}

/** Luminance perçue approx. (0 sombre → 1 clair) pour choisir un texte contrasté. */
function luminance([r, g, b]: [number, number, number]): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Couleur d'une cellule : neutre à 0, dégradé vers `up` (positif) ou `down` (négatif).
 * Cellule sans valeur → couleur de bordure (creux « pas de donnée »).
 */
function couleurCellule(
  v: number | null,
  neutre: [number, number, number],
  up: [number, number, number],
  down: [number, number, number],
  vide: [number, number, number]
): [number, number, number] {
  if (v === null || !Number.isFinite(v)) return vide;
  const t = Math.max(-1, Math.min(1, v));
  return t >= 0 ? melanger(neutre, up, t) : melanger(neutre, down, -t);
}

/** Base d'un symbole (retire la cotation) pour l'étiquette compacte de la matrice. */
function courtSymbole(s: string): string {
  if (s.includes("/")) return s; // forex EUR/USD conservé
  for (const q of QUOTE_ASSETS) {
    if (s.endsWith(q) && s.length > q.length) return s.slice(0, -q.length);
  }
  return s;
}

/** Formatte une corrélation signée (2 décimales) ou « — » si indéfinie. */
function fmtCorr(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toFixed(2);
}

// ─────────────────────────── Géométrie de la matrice ───────────────────────────

const GUTTER_L = 54; // marge gauche pour les étiquettes de lignes
const GUTTER_T = 18; // marge haute pour les étiquettes de colonnes

/** Taille de cellule adaptée au nombre de symboles (matrice plus dense = cellules plus petites). */
function tailleCellule(n: number): number {
  if (n <= 5) return 46;
  if (n <= 8) return 38;
  if (n <= 12) return 30;
  return 24;
}

/** Fenêtres de calcul proposées (en jours). */
const FENETRES: readonly number[] = [30, 90, 180];

// ─────────────────────────── Composant ───────────────────────────

export function CorrWindow() {
  const open = useStore(corrUiStore, (s) => s.open);
  const closeCorr = useStore(corrUiStore, (s) => s.closeCorr);
  const watchSymbols = useStore(watchlistStore, (s) => s.symbols);

  const [methode, setMethode] = useState<MethodeCorr>("pearson");
  const [fenetreJours, setFenetreJours] = useState<number>(90);
  const [extras, setExtras] = useState<string[]>([]);
  const [saisie, setSaisie] = useState("");
  const [nonce, setNonce] = useState(0); // bump = recalcul forcé (re-fetch)
  const [matrice, setMatrice] = useState<MatriceCorr | null>(null);
  const [loading, setLoading] = useState(false);
  const [majTs, setMajTs] = useState<number | null>(null);
  const [selection, setSelection] = useState<{ r: number; c: number } | null>(null);
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  // Séries chargées (pour la sparkline glissante) — hors state React (pas de re-render).
  const seriesRef = useRef<Map<string, SerieCloture[]>>(new Map());
  const matrixCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sparkCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Symboles = watchlist (groupe actif) + ajouts ponctuels, normalisés et dédoublonnés.
  const symbols = useMemo(() => {
    const all = [...watchSymbols, ...extras].map((s) => s.trim().toUpperCase()).filter((s) => s.length > 0);
    return [...new Set(all)];
  }, [watchSymbols, extras]);

  // Chargement + calcul de la matrice (déclenché à l'ouverture et sur changement de
  // symboles / méthode / fenêtre / recalcul). Changer la fenêtre ou la méthode NE refetch
  // PAS (cache session) ; seul « recalculer » (nonce) vide le cache au préalable.
  useEffect(() => {
    if (!open) return;
    let ignore = false;
    if (symbols.length < 2) {
      setMatrice(null);
      setSelection(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void (async () => {
      const seriesMap = await chargerSeries(symbols);
      if (ignore) return;
      seriesRef.current = seriesMap;
      setMatrice(calculerMatrice(seriesMap, symbols, methode, fenetreJours));
      setSelection(null);
      setMajTs(Date.now());
      setLoading(false);
    })();
    return () => {
      ignore = true;
    };
  }, [open, symbols, methode, fenetreJours, nonce]);

  // Dessin de la matrice (canvas) — redessine sur nouvelle matrice / survol / sélection.
  useEffect(() => {
    const canvas = matrixCanvasRef.current;
    if (canvas === null || matrice === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;

    const n = matrice.symbols.length;
    const cell = tailleCellule(n);
    const W = GUTTER_L + n * cell + 4;
    const H = GUTTER_T + n * cell + 4;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const up = hexRgb(lireVar("--up")) ?? [45, 192, 142];
    const down = hexRgb(lireVar("--down")) ?? [249, 40, 85];
    const neutre = hexRgb(lireVar("--surface")) ?? [23, 23, 23];
    const vide = hexRgb(lireVar("--border")) ?? [38, 38, 38];
    const dim = lireVar("--text-dim") || "#9ca3af";
    const texte = lireVar("--text") || "#e5e7eb";

    // Étiquettes de colonnes (base des symboles, en haut).
    ctx.font = "9px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = dim;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (let c = 0; c < n; c++) {
      const label = courtSymbole(matrice.symbols[c] ?? "");
      ctx.fillText(label, GUTTER_L + c * cell + cell / 2, GUTTER_T - 6, cell);
    }
    // Étiquettes de lignes (à gauche).
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let r = 0; r < n; r++) {
      const label = courtSymbole(matrice.symbols[r] ?? "");
      ctx.fillText(label, GUTTER_L - 6, GUTTER_T + r * cell + cell / 2, GUTTER_L - 8);
    }

    // Cellules.
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const cel = matrice.cellules[r]?.[c];
        const v = cel?.valeur ?? null;
        const rgb = couleurCellule(v, neutre, up, down, vide);
        const x = GUTTER_L + c * cell;
        const y = GUTTER_T + r * cell;
        ctx.fillStyle = rgbCss(rgb);
        ctx.fillRect(x, y, cell - 1, cell - 1);

        // Valeur au centre quand la cellule est assez grande et la valeur définie.
        if (cell >= 34 && v !== null && Number.isFinite(v)) {
          ctx.fillStyle = luminance(rgb) > 0.55 ? "#0b0b0b" : "#f5f5f5";
          ctx.font = "10px ui-monospace, monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(v.toFixed(2), x + (cell - 1) / 2, y + (cell - 1) / 2);
        }
      }
    }

    // Surbrillance : survol (contour clair) puis sélection (contour accentué) par-dessus.
    const cadre = (r: number, c: number, couleur: string, w: number) => {
      ctx.strokeStyle = couleur;
      ctx.lineWidth = w;
      ctx.strokeRect(GUTTER_L + c * cell + 0.5, GUTTER_T + r * cell + 0.5, cell - 2, cell - 2);
    };
    if (hover) cadre(hover.r, hover.c, texte, 1);
    if (selection) cadre(selection.r, selection.c, lireVar("--accent") || texte, 2);
  }, [matrice, hover, selection]);

  // Dessin de la sparkline de corrélation glissante 30 j pour la cellule sélectionnée.
  useEffect(() => {
    const canvas = sparkCanvasRef.current;
    if (canvas === null || selection === null || matrice === null) return;
    const { r, c } = selection;
    const sr = matrice.symbols[r];
    const sc = matrice.symbols[c];
    if (sr === undefined || sc === undefined) return;
    const A = seriesRef.current.get(sr) ?? [];
    const B = seriesRef.current.get(sc) ?? [];
    const { a, b } = alignerSeries(A, B);
    const serie = correlationGlissante(methode, logRendements(a), logRendements(b), 30);

    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    const W = 260;
    const Hp = 60;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(Hp * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${Hp}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, Hp);

    const dim = lireVar("--text-dim") || "#9ca3af";
    const accent = lireVar("--accent") || lireVar("--text") || "#38bdf8";
    const pad = 6;
    const mid = Hp / 2;
    const half = mid - pad;
    // Repère : ligne 0 et bornes ±1.
    ctx.strokeStyle = dim;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(W, mid);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (serie.length >= 2) {
      const step = W / (serie.length - 1);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      let dessine = false;
      serie.forEach((v, i) => {
        if (v === null || !Number.isFinite(v)) {
          dessine = false; // trou : on interrompt le tracé
          return;
        }
        const x = i * step;
        const y = mid - Math.max(-1, Math.min(1, v)) * half;
        if (dessine) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        dessine = true;
      });
      ctx.stroke();
    }
  }, [selection, methode, matrice]);

  // Interactions de la matrice (survol → tooltip ; clic → sélection pour le mini-détail).
  const n = matrice?.symbols.length ?? 0;
  const cell = tailleCellule(n);

  const cellDepuisEvenement = (clientX: number, clientY: number, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const cx = Math.floor((clientX - rect.left - GUTTER_L) / cell);
    const cy = Math.floor((clientY - rect.top - GUTTER_T) / cell);
    if (clientX - rect.left < GUTTER_L || clientY - rect.top < GUTTER_T) return null;
    if (cx < 0 || cx >= n || cy < 0 || cy >= n) return null;
    return { r: cy, c: cx, localX: clientX - rect.left, localY: clientY - rect.top };
  };

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (matrice === null) return;
    const hit = cellDepuisEvenement(e.clientX, e.clientY, e.currentTarget);
    if (hit === null) {
      setHover(null);
      setTooltip(null);
      return;
    }
    setHover({ r: hit.r, c: hit.c });
    const cel = matrice.cellules[hit.r]?.[hit.c];
    const sr = matrice.symbols[hit.r];
    const sc = matrice.symbols[hit.c];
    setTooltip({
      x: hit.localX,
      y: hit.localY,
      text: `${sr} × ${sc} · r=${fmtCorr(cel?.valeur)} · n=${cel?.points ?? 0}`,
    });
  };

  const onLeave = () => {
    setHover(null);
    setTooltip(null);
  };

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (matrice === null) return;
    const hit = cellDepuisEvenement(e.clientX, e.clientY, e.currentTarget);
    if (hit === null || hit.r === hit.c) {
      setSelection(null); // diagonale (auto-corrélation = 1) → pas de mini-détail
      return;
    }
    setSelection({ r: hit.r, c: hit.c });
  };

  const recalculer = () => {
    viderCacheSeries(); // re-fetch forcé (le simple ré-affichage reste sur cache)
    setNonce((k) => k + 1);
  };

  const ajouterSymbole = (e: React.FormEvent) => {
    e.preventDefault();
    const v = saisie.trim().toUpperCase();
    setSaisie("");
    if (v.length === 0 || symbols.includes(v)) return;
    setExtras((x) => (x.includes(v) ? x : [...x, v]));
  };

  const selCellule = selection ? matrice?.cellules[selection.r]?.[selection.c] : undefined;
  const selLabel =
    selection && matrice
      ? `${matrice.symbols[selection.r] ?? ""} × ${matrice.symbols[selection.c] ?? ""}`
      : "";

  return (
    <aside
      role="complementary"
      aria-label="Corrélations"
      aria-hidden={!open}
      className={`fixed right-0 top-0 z-40 flex h-full w-[min(480px,94vw)] flex-col border-l border-border bg-surface shadow-2xl transition-transform duration-200 ${
        open ? "translate-x-0" : "pointer-events-none translate-x-full"
      }`}
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-text">Corrélations</h2>
          <p className="mt-0.5 text-[11px] text-text-dim">
            Log-rendements journaliers · {methode === "pearson" ? "Pearson" : "Spearman"} · {fenetreJours} j
          </p>
        </div>
        <button
          type="button"
          onClick={closeCorr}
          aria-label="Fermer les corrélations"
          className="rounded p-1 text-lg leading-none text-text-dim transition hover:bg-bg hover:text-text"
        >
          ✕
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* Contrôles : méthode, fenêtre, recalcul + fraîcheur. */}
        <div className="mb-3 space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-border bg-bg p-0.5 text-[11px]">
              {(["pearson", "spearman"] as MethodeCorr[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethode(m)}
                  className={`rounded px-2 py-1 transition ${
                    methode === m ? "bg-surface text-text" : "text-text-dim hover:text-text"
                  }`}
                >
                  {m === "pearson" ? "Pearson" : "Spearman"}
                </button>
              ))}
            </div>
            <div className="flex rounded-md border border-border bg-bg p-0.5 text-[11px]">
              {FENETRES.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFenetreJours(f)}
                  className={`rounded px-2 py-1 transition ${
                    fenetreJours === f ? "bg-surface text-text" : "text-text-dim hover:text-text"
                  }`}
                >
                  {f}j
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between text-[11px] text-text-dim">
            <button
              type="button"
              onClick={recalculer}
              className="rounded border border-border bg-bg px-2 py-1 text-text-dim transition hover:text-text"
            >
              ↻ Recalculer
            </button>
            <span className="tabular-nums">
              {loading
                ? "calcul…"
                : majTs
                  ? `maj ${new Date(majTs).toLocaleTimeString("fr-FR", { hour12: false })}`
                  : "—"}
            </span>
          </div>
        </div>

        {/* Ajout ponctuel de symboles (hors watchlist). */}
        <form onSubmit={ajouterSymbole} className="mb-3 flex gap-2">
          <input
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            placeholder="Ajouter un symbole (ex. AVAXUSDT, SPY)"
            className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1.5 text-[11px] text-text placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-border"
          />
          <button
            type="submit"
            className="rounded-md border border-border bg-bg px-2.5 py-1.5 text-[11px] text-text-dim transition hover:text-text"
          >
            +
          </button>
        </form>
        {extras.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {extras.map((s) => (
              <span
                key={s}
                className="flex items-center gap-1 rounded border border-border bg-bg px-1.5 py-0.5 text-[10px] text-text-dim"
              >
                {s}
                <button
                  type="button"
                  onClick={() => setExtras((x) => x.filter((v) => v !== s))}
                  aria-label={`Retirer ${s}`}
                  className="leading-none text-text-dim transition hover:text-down"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Matrice ou message d'état. */}
        {symbols.length < 2 ? (
          <div className="rounded-md border border-border bg-bg px-3 py-3 text-xs leading-snug text-text-dim">
            Au moins deux symboles sont nécessaires. Ajoutez-en à la watchlist ou via le champ ci-dessus.
          </div>
        ) : matrice === null ? (
          <div className="rounded-md border border-border bg-bg px-3 py-3 text-xs text-text-dim">Calcul…</div>
        ) : (
          <div className="relative">
            <div className="overflow-x-auto">
              <canvas
                ref={matrixCanvasRef}
                onMouseMove={onMove}
                onMouseLeave={onLeave}
                onClick={onClick}
                className="cursor-pointer"
              />
            </div>
            {tooltip && (
              <div
                className="pointer-events-none absolute z-10 rounded border border-border bg-surface px-2 py-1 text-[10px] tabular-nums text-text shadow-lg"
                style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
              >
                {tooltip.text}
              </div>
            )}
          </div>
        )}

        {/* Mini-détail : corrélation glissante 30 j de la cellule sélectionnée. */}
        {selection && matrice && (
          <section className="mt-3 rounded-md border border-border bg-bg">
            <div className="flex items-baseline justify-between border-b border-border px-3 py-2">
              <span className="text-[11px] font-medium text-text">{selLabel}</span>
              <span className="text-[11px] tabular-nums text-text-dim">
                r={fmtCorr(selCellule?.valeur)} · n={selCellule?.points ?? 0}
              </span>
            </div>
            <div className="px-3 py-2">
              <canvas ref={sparkCanvasRef} className="w-full" />
              <p className="mt-1 text-[10px] leading-snug text-text-dim">
                Corrélation glissante sur 30 rendements (fenêtre de 30 jours communs).
              </p>
            </div>
          </section>
        )}

        <p className="mt-3 text-[10px] leading-snug text-text-dim">
          Corrélations sur log-rendements journaliers, alignés sur les jours calendaires UTC communs
          (crypto 7j/7 vs bourse 5j/7). Klines réutilisées des sources existantes, en cache de session.
        </p>
      </div>
    </aside>
  );
}
