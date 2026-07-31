/**
 * Panneau « CORR » — matrice de corrélation, dockable à droite, NON MODAL (pas d'overlay).
 *
 * Suit le pattern DerivativesWindow : panneau translaté hors écran quand fermé (inerte,
 * pointer-events-none), toggle par le mnémonique CORR ou une commande de la palette. Le
 * graphe reste interactif pendant l'analyse.
 *
 * Contenu :
 *  - matrice N×N (canvas) sur les symboles de la WATCHLIST + références tradfi préréglées
 *    (S&P 500, Nasdaq, or, dollar, forex — toggles individuels) + ajout ponctuel, dégradé
 *    down→up entre -1 et +1, valeur au survol, cellules à n < 20 rendements ATTÉNUÉES ;
 *  - clic sur une cellule = mini-détail : corrélation glissante en sparkline (canvas),
 *    fenêtre glissante = LA fenêtre sélectionnée (30/90/180) ;
 *  - bascule Pearson / Spearman, fenêtre 30/90/180 j, bouton « recalculer » (re-fetch forcé),
 *    indication de fraîcheur, chips d'erreur par symbole en échec de chargement.
 *
 * Données : klines 1d des adaptateurs existants (aucune source nouvelle), en CACHE session
 * (réouvrir ≠ refetch ; changer méthode/fenêtre ne refetch pas — quota Twelve Data ménagé).
 * Le point du jour UTC courant est EXCLU des calculs (bougie partielle, crypto comme tradfi).
 * Réglages (méthode, fenêtre, extras, références) dans le store PERSISTÉ store/corrUi.ts —
 * la fermeture démonte le composant, un useState les perdait. L'état de session (sélection,
 * survol, saisie) reste en React ; seul le dessin passe par le canvas.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type { Commande } from "../commands/registry";
import { watchlistStore } from "../store/watchlist";
import { corrUiStore } from "../store/corrUi";
import { QUOTE_ASSETS } from "../data/symbol";
import {
  alignerSeries,
  calculerMatrice,
  chargerSeries,
  correlationGlissante,
  exclureJourCourant,
  FENETRES_CORR,
  logRendements,
  pointsFiables,
  REFERENCES_CORR,
  SEUIL_POINTS_FIABLES,
  symbolesEnEchec,
  viderCacheSeries,
  type MatriceCorr,
  type SerieCloture,
} from "../data/corr";
import { formatDec } from "../lib/format";
import { lireTokenCanvas, POLICE_CANVAS, POLICE_CANVAS_MONO } from "../lib/canvasTokens";
import { Badge, Bouton, BoutonBascule, BoutonRafraichir, Chargement, Chip, EnTeteFenetre, Fraicheur, Input, NoteSource, Segmente, Vide } from "./ui";

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

// ─────────────────────────── Composant ───────────────────────────

export function CorrWindow() {
  const open = useStore(corrUiStore, (s) => s.open);
  const watchSymbols = useStore(watchlistStore, (s) => s.symbols);

  // Réglages persistés (store corrUi — survivent à la fermeture/réouverture).
  const methode = useStore(corrUiStore, (s) => s.methode);
  const fenetreJours = useStore(corrUiStore, (s) => s.fenetreJours);
  const extras = useStore(corrUiStore, (s) => s.extras);
  const referencesActives = useStore(corrUiStore, (s) => s.referencesActives);

  const [saisie, setSaisie] = useState("");
  const [nonce, setNonce] = useState(0); // bump = recalcul forcé (re-fetch)
  const [matrice, setMatrice] = useState<MatriceCorr | null>(null);
  const [echecs, setEchecs] = useState<string[]>([]); // symboles en échec de chargement
  const [loading, setLoading] = useState(false);
  const [majTs, setMajTs] = useState<number | null>(null);
  const [selection, setSelection] = useState<{ r: number; c: number } | null>(null);
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  // Séries chargées (pour la sparkline glissante) — hors state React (pas de re-render).
  const seriesRef = useRef<Map<string, SerieCloture[]>>(new Map());
  const matrixCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sparkCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Symboles = watchlist (groupe actif) + références tradfi actives + ajouts ponctuels,
  // normalisés et dédoublonnés (les références forment un bloc contigu dans la matrice).
  const symbols = useMemo(() => {
    const all = [...watchSymbols, ...referencesActives, ...extras]
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0);
    return [...new Set(all)];
  }, [watchSymbols, referencesActives, extras]);

  // Chargement + calcul de la matrice (déclenché à l'ouverture et sur changement de
  // symboles / méthode / fenêtre / recalcul). Changer la fenêtre ou la méthode NE refetch
  // PAS (cache session) ; seul « recalculer » (nonce) vide le cache au préalable.
  useEffect(() => {
    if (!open) return;
    let ignore = false;
    if (symbols.length < 2) {
      setMatrice(null);
      setSelection(null);
      setEchecs([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    void (async () => {
      const brutes = await chargerSeries(symbols);
      if (ignore) return;
      // Bougie du jour partielle (crypto comme tradfi) : le point du jour UTC courant
      // est écarté AVANT tout calcul (matrice ET sparkline via seriesRef).
      const seriesMap = new Map<string, SerieCloture[]>();
      for (const [s, serie] of brutes) seriesMap.set(s, exclureJourCourant(serie, Date.now()));
      seriesRef.current = seriesMap;
      setEchecs(symbolesEnEchec(brutes, symbols)); // sur les séries BRUTES : vide = échec de chargement
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

    const up = hexRgb(lireTokenCanvas("--up", "#2dc08e")) ?? [45, 192, 142];
    const down = hexRgb(lireTokenCanvas("--down", "#f92855")) ?? [249, 40, 85];
    const neutre = hexRgb(lireTokenCanvas("--surface", "#171717")) ?? [23, 23, 23];
    const vide = hexRgb(lireTokenCanvas("--border", "#262626")) ?? [38, 38, 38];
    const dim = lireTokenCanvas("--text-dim", "#9ca3af");
    const texte = lireTokenCanvas("--text", "#e5e7eb");

    // Étiquettes de colonnes (base des symboles, en haut).
    ctx.font = POLICE_CANVAS;
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
        // Fiabilité : une cellule calculée sur trop peu de rendements communs (croisement
        // crypto×tradfi à fenêtre courte) est ATTÉNUÉE — cf. note de légende sous la matrice.
        const attenuee = v !== null && Number.isFinite(v) && !pointsFiables(cel?.points ?? 0);
        if (attenuee) ctx.globalAlpha = 0.35;
        ctx.fillStyle = rgbCss(rgb);
        ctx.fillRect(x, y, cell - 1, cell - 1);

        // Valeur au centre quand la cellule est assez grande et la valeur définie.
        if (cell >= 34 && v !== null && Number.isFinite(v)) {
          // Texte contrasté sur le fond CALCULÉ de la cellule : noir/blanc quasi purs,
          // volontairement hors thème (le contraste suit la luminance de la cellule, pas
          // le thème — dériver de --text inverserait le contraste en thème clair).
          ctx.fillStyle = luminance(rgb) > 0.55 ? "#0b0b0b" : "#f5f5f5";
          ctx.font = POLICE_CANVAS_MONO;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(v.toFixed(2), x + (cell - 1) / 2, y + (cell - 1) / 2);
        }
        if (attenuee) ctx.globalAlpha = 1;
      }
    }

    // Surbrillance : survol (contour clair) puis sélection (contour accentué) par-dessus.
    const cadre = (r: number, c: number, couleur: string, w: number) => {
      ctx.strokeStyle = couleur;
      ctx.lineWidth = w;
      ctx.strokeRect(GUTTER_L + c * cell + 0.5, GUTTER_T + r * cell + 0.5, cell - 2, cell - 2);
    };
    if (hover) cadre(hover.r, hover.c, texte, 1);
    if (selection) cadre(selection.r, selection.c, lireTokenCanvas("--accent", texte), 2);
  }, [matrice, hover, selection]);

  // Dessin de la sparkline de corrélation glissante pour la cellule sélectionnée —
  // fenêtre glissante = LA fenêtre sélectionnée (30/90/180 rendements communs).
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
    const serie = correlationGlissante(methode, logRendements(a), logRendements(b), fenetreJours);

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

    const dim = lireTokenCanvas("--text-dim", "#9ca3af");
    const accent = lireTokenCanvas("--accent", lireTokenCanvas("--text", "#38bdf8"));
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
  }, [selection, methode, fenetreJours, matrice]);

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
      text: `${sr} × ${sc} · r=${formatDec(cel?.valeur)} · n=${cel?.points ?? 0}`,
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
    corrUiStore.getState().ajouterExtra(v);
  };

  const selCellule = selection ? matrice?.cellules[selection.r]?.[selection.c] : undefined;
  const selLabel =
    selection && matrice
      ? `${matrice.symbols[selection.r] ?? ""} × ${matrice.symbols[selection.c] ?? ""}`
      : "";

  return (
    <>
      {/* En-tête standard ; croix de fermeture fournie par le chrome FloatingWindow. */}
      <EnTeteFenetre
        mnemo="CORR"
        titre="Corrélations"
        sousTitre={`Log-rendements journaliers · ${methode === "pearson" ? "Pearson" : "Spearman"} · ${fenetreJours} j`}
        actions={
          <>
            <Fraicheur loading={loading} majTs={majTs} />
            <BoutonRafraichir onClick={recalculer} libelle="Recalculer" />
          </>
        }
      />

      <div className="px-4 py-3">
        {/* Contrôles : méthode, fenêtre (réglages persistés — store corrUi). */}
        <div className="mb-3 flex items-center gap-2">
          <Segmente
            options={[
              { id: "pearson", label: "Pearson" },
              { id: "spearman", label: "Spearman" },
            ] as const}
            actif={methode}
            onChange={(m) => corrUiStore.getState().setMethode(m)}
          />
          <Segmente
            options={FENETRES_CORR.map((f) => ({ id: f, label: `${f}j` }))}
            actif={fenetreJours}
            onChange={(f) => corrUiStore.getState().setFenetre(f)}
          />
        </div>

        {/* Références tradfi préréglées : toggles individuels, les actives rejoignent
            l'univers de la matrice (routage curé → twelvedata, 1 crédit par recalcul). */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Références tradfi">
          {REFERENCES_CORR.map((ref) => (
            <BoutonBascule
              key={ref.symbole}
              actif={referencesActives.includes(ref.symbole)}
              onClick={() => corrUiStore.getState().basculerReference(ref.symbole)}
              title={`${ref.libelle} — croiser avec la matrice`}
            >
              {ref.libelle}
            </BoutonBascule>
          ))}
        </div>

        {/* Ajout ponctuel de symboles (hors watchlist). */}
        <form onSubmit={ajouterSymbole} className="mb-3 flex gap-2">
          <Input
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            placeholder="Ajouter un symbole (ex. AVAXUSDT, SPY)"
            className="min-w-0 flex-1"
          />
          <Bouton type="submit">+</Bouton>
        </form>
        {extras.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {extras.map((s) => (
              <Chip key={s} onRetirer={() => corrUiStore.getState().retirerExtra(s)} retirerLabel={`Retirer ${s}`}>
                {s}
              </Chip>
            ))}
          </div>
        )}

        {/* Chips d'erreur : chaque série en échec est signalée (plus de cellules vides
            silencieuses — un quota Twelve Data épuisé est la cause la plus probable). */}
        {echecs.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {echecs.map((s) => (
              <Badge key={s} ton="warn" title={`Série ${s} indisponible : cellules vides dans la matrice`}>
                {s} — échec de chargement (quota ?)
              </Badge>
            ))}
          </div>
        )}

        {/* Matrice ou message d'état. */}
        {symbols.length < 2 ? (
          <Vide>Au moins deux symboles sont nécessaires. Ajoutez-en à la watchlist ou via le champ ci-dessus.</Vide>
        ) : matrice === null ? (
          <Chargement libelle="Calcul…" />
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
                className="pointer-events-none absolute z-10 rounded border border-border bg-surface px-2 py-1 text-[11px] tabular-nums text-text shadow-lg"
                style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
              >
                {tooltip.text}
              </div>
            )}
            <p className="mt-1 text-[10px] leading-snug text-text-dim">
              Cellules atténuées : n &lt; {SEUIL_POINTS_FIABLES} rendements communs (fiabilité limitée —
              l'alignement sur les jours de bourse écarte les week-ends).
            </p>
          </div>
        )}

        {/* Mini-détail : corrélation glissante (fenêtre sélectionnée) de la cellule choisie. */}
        {selection && matrice && (
          <section className="mt-3 rounded-md border border-border bg-bg">
            <div className="flex items-baseline justify-between border-b border-border px-3 py-2">
              <span className="text-[11px] font-medium text-text">{selLabel}</span>
              <span className="text-[11px] tabular-nums text-text-dim">
                r={formatDec(selCellule?.valeur)} · n={selCellule?.points ?? 0}
              </span>
            </div>
            <div className="px-3 py-2">
              <canvas ref={sparkCanvasRef} className="w-full" />
              <p className="mt-1 text-[10px] leading-snug text-text-dim">
                Corrélation glissante sur {fenetreJours} rendements communs (fenêtre sélectionnée).
              </p>
            </div>
          </section>
        )}

        <div className="mt-3">
          <NoteSource>
            Corrélations sur log-rendements journaliers, alignés sur les jours calendaires UTC communs
            (crypto 7j/7 vs bourse 5j/7) ; clôtures NON synchrones (bourse ~20-21h UTC vs crypto 00:00 UTC) ;
            jour en cours exclu (bougie partielle). Proxys assumés : UUP = dollar (DXY), GLD = or.
            Klines réutilisées des sources existantes, en cache de session.
          </NoteSource>
        </div>
      </div>
    </>
  );
}
