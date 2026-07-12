/**
 * Panneau « Vue marché » (IMAP) — dockable à droite, NON MODAL (pas d'overlay).
 *
 * Deux onglets :
 *   • Carte    : treemap canvas des ~100 premières cryptos par capitalisation.
 *                Taille de tuile = mcap ; couleur = Δ24 h (dégradé down→up, tokens de
 *                thème). Survol = détails (tooltip) ; CLIC = ouvre la paire sur le chart
 *                (résolution symbole→USDT Binance best-effort, sinon rien).
 *   • Secteurs : barres de performance 24 h par catégorie CoinGecko.
 * En-tête : mcap total, dominance BTC/ETH, volume 24 h, Fear & Greed.
 *
 * Données via data/marketOverview (CoinGecko public + F&G proxifié /extapi), cache
 * 5 min / 1 h. Le rendu de la treemap est IMPÉRATIF (canvas + refs, pas de state React
 * par tuile) ; seules les données lentes vivent en state. Ouverture via le bouton de
 * Toolbar ou le mnémonique IMAP (toggle). Fermé → inerte (pointer-events-none).
 *
 * Sans réseau : le panneau retombe sur le cache périmé et affiche « maj il y a … » ;
 * aucune erreur console en boucle.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { Commande } from "../commands/registry"; // type-only : aucune dépendance runtime croisée
import { marketStore } from "../store/market";
import { themeStore } from "../store/theme";
import { marketMapUiStore } from "../store/marketmap-ui";
import { fetchPairs } from "../data/pairs";
import { squarify, type Rect, type Tuile } from "../lib/treemap";
import { formatAge, formatPct, formatUsd } from "../lib/format";
import { lireTokensCanvas } from "../lib/canvasTokens";
import { ErreurBloc, NoteSource, Onglets } from "./ui";
import {
  fetchFearGreed,
  fetchMarketOverview,
  toBinanceUsdtPair,
  type CoinTile,
  type FearGreed,
  type MarketOverview,
} from "../data/marketOverview";

/** Nombre de tuiles affichées (top par capitalisation). */
const MAX_TILES = 100;
/** Nombre de secteurs affichés. */
const MAX_SECTORS = 24;
/** Cadence de rafraîchissement (le cache 5 min absorbe les appels réseau). */
const REFRESH_MS = 5 * 60_000;
/** Amplitude de Δ24 h (%) saturant le dégradé de couleur. */
const CHANGE_SATURATION = 8;

// ─────────────────────────── Couleurs (tokens de thème) ───────────────────────────

/** Jeu de couleurs lu depuis les variables CSS du thème courant. */
interface Tokens {
  up: [number, number, number];
  down: [number, number, number];
  neutral: [number, number, number];
  border: [number, number, number];
  text: [number, number, number];
  /** Thème clair (fond lumineux) : neutre assombri + bord dérivé de --text pour
   *  délimiter les tuiles ; en dark on garde les valeurs d'origine (audit #20). */
  clair: boolean;
}

/** Luminance perçue (0–1) d'une couleur RVB. */
function luminance(c: [number, number, number]): number {
  return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
}

/** Parse « #rrggbb » (ou « #rgb ») en composantes RVB ; gris moyen par défaut. */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.trim().replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const int = Number.parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(int)) return [80, 80, 80];
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

/** Lit les tokens de couleur du thème (relu à chaque changement de thème). */
function readTokens(): Tokens {
  const t = lireTokensCanvas(["--up", "--down", "--surface", "--border", "--text"]);
  const surface = hexToRgb(t["--surface"]);
  const text = hexToRgb(t["--text"]);
  const clair = luminance(surface) > 0.5;
  return {
    up: hexToRgb(t["--up"]),
    down: hexToRgb(t["--down"]),
    // Tuile à ~0 % : en thème CLAIR (« cute » quasi-blanc), gris moyen (--surface mêlé
    // à --text, 32 %) plutôt que --surface brut, qui se confondait avec le fond du
    // panneau — les méga-caps disparaissaient (audit #20). En DARK on garde --surface
    // brut d'origine (neutre sombre volontairement fondu au panneau : ne pas régresser).
    neutral: clair ? lerp(surface, text, 0.32) : surface,
    border: hexToRgb(t["--border"]),
    text,
    clair,
  };
}

/** Interpolation linéaire de deux couleurs RVB. */
function lerp(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** RVB d'une tuile pour une variation `change` (%), dégradé divergent neutre→down/up. */
function tileRgb(change: number, tok: Tokens): [number, number, number] {
  const t = Math.max(-1, Math.min(1, change / CHANGE_SATURATION));
  return t >= 0 ? lerp(tok.neutral, tok.up, t) : lerp(tok.neutral, tok.down, -t);
}

/** Chaîne CSS « rgb(r,g,b) » (composantes arrondies). */
function rgbCss(rgb: [number, number, number]): string {
  return `rgb(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])})`;
}

/** Texte lisible (clair/sombre) selon la luminance du fond. */
function labelColor(rgb: [number, number, number]): string {
  const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return lum > 0.6 ? "#111111" : "#f5f5f5";
}

// ─────────────────────────── Dessin treemap ───────────────────────────

/** Dessine une tuile (fond + bordure + labels adaptatifs). */
function drawTile(ctx: CanvasRenderingContext2D, t: Tuile<CoinTile>, tok: Tokens, highlight: boolean): void {
  const { x, y, w, h } = t.rect;
  const change = t.item.changePct24h;
  const rgb = tileRgb(change, tok);

  ctx.fillStyle = rgbCss(rgb);
  ctx.fillRect(x, y, w, h);

  // Bord non-survolé : en thème CLAIR, dérivé de --text (rgba 0.3) car --border est
  // quasi invisible en « cute » — pour toujours délimiter les tuiles (audit #20). En
  // DARK on garde --border d'origine (contraste déjà correct : ne pas régresser).
  ctx.strokeStyle = highlight
    ? rgbCss(tok.text)
    : tok.clair
      ? `rgba(${Math.round(tok.text[0])},${Math.round(tok.text[1])},${Math.round(tok.text[2])},0.3)`
      : rgbCss(tok.border);
  ctx.lineWidth = highlight ? 2 : 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  // Labels seulement si la tuile est assez grande (sinon illisible / surchargé).
  if (w < 34 || h < 16) return;
  const color = labelColor(rgb);
  ctx.fillStyle = color;
  ctx.textBaseline = "top";
  const fontSym = Math.max(9, Math.min(16, Math.round(w / 5)));
  ctx.font = `600 ${fontSym}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText(t.item.symbol, x + 4, y + 4, w - 8);
  if (w >= 56 && h >= 34) {
    ctx.font = `${Math.max(9, fontSym - 3)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText(formatPct(change), x + 4, y + 6 + fontSym, w - 8);
  }
}

/** Dessine un tooltip (nom, prix, mcap, Δ) près du curseur, borné au canvas. */
function drawTooltip(
  ctx: CanvasRenderingContext2D,
  t: CoinTile,
  mx: number,
  my: number,
  cw: number,
  ch: number,
  tok: Tokens,
): void {
  const lignes = [t.name, `${formatUsd(t.price)} · ${formatPct(t.changePct24h)}`, `Cap. ${formatUsd(t.mcapUsd)}`];
  ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
  const wBox = Math.max(...lignes.map((l) => ctx.measureText(l).width)) + 16;
  const hBox = lignes.length * 15 + 10;
  let bx = mx + 12;
  let by = my + 12;
  if (bx + wBox > cw) bx = cw - wBox - 2;
  if (by + hBox > ch) by = ch - hBox - 2;

  // Couleurs dérivées des tokens de thème (fond surface translucide, bordure/texte du thème).
  ctx.fillStyle = `rgba(${tok.neutral[0]},${tok.neutral[1]},${tok.neutral[2]},0.95)`;
  ctx.strokeStyle = rgbCss(tok.border);
  ctx.lineWidth = 1;
  ctx.fillRect(bx, by, wBox, hBox);
  ctx.strokeRect(bx + 0.5, by + 0.5, wBox, hBox);
  ctx.fillStyle = rgbCss(tok.text);
  ctx.textBaseline = "top";
  lignes.forEach((l, i) => ctx.fillText(l, bx + 8, by + 6 + i * 15));
}

// ─────────────────────────── Onglet Secteurs (DOM) ───────────────────────────

/** Barres de performance sectorielle (DOM simple, données lentes). */
function SectorsTab({ overview }: { overview: MarketOverview | null }) {
  const secteurs = (overview?.sectors ?? []).slice(0, MAX_SECTORS);
  if (secteurs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[11px] text-text-dim">
        Secteurs indisponibles.
      </div>
    );
  }
  const maxAbs = Math.max(1, ...secteurs.map((s) => Math.abs(s.changePct24h)));
  return (
    <div className="flex flex-col gap-1.5 overflow-y-auto px-4 py-3">
      {secteurs.map((s) => {
        const largeur = `${(Math.abs(s.changePct24h) / maxAbs) * 100}%`;
        const positif = s.changePct24h >= 0;
        return (
          <div key={s.id} className="flex items-center gap-2 text-[11px]">
            <span className="w-40 shrink-0 truncate text-text" title={s.name}>
              {s.name}
            </span>
            <div className="relative h-3 flex-1 rounded-sm bg-bg">
              <div
                className={`absolute top-0 h-3 rounded-sm ${positif ? "bg-up" : "bg-down"}`}
                style={{ width: largeur }}
              />
            </div>
            <span className={`w-16 shrink-0 text-right tabular-nums ${positif ? "text-up" : "text-down"}`}>
              {formatPct(s.changePct24h)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────── Composant principal ───────────────────────────

export function MarketMapWindow() {
  const open = useStore(marketMapUiStore, (s) => s.open);
  const themeId = useStore(themeStore, (s) => s.theme); // redessine au changement de thème

  const [tab, setTab] = useState<"carte" | "secteurs">("carte");
  const [overview, setOverview] = useState<MarketOverview | null>(null);
  const [fng, setFng] = useState<FearGreed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sizeTick, setSizeTick] = useState(0); // incrémenté par le ResizeObserver

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const layoutRef = useRef<Tuile<CoinTile>[]>([]); // dernier layout en px CSS (hit-test)
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const hoverRef = useRef<number>(-1);
  const mouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const rafRef = useRef<number>(0);
  const binancePairsRef = useRef<Set<string> | null>(null);
  const paintRef = useRef<() => void>(() => {});

  // — Chargement des données (uniquement fenêtre ouverte) —
  useEffect(() => {
    if (!open) return;
    let ignore = false;

    const load = async () => {
      setLoading(true);
      try {
        const [ov, fg] = await Promise.all([fetchMarketOverview(), fetchFearGreed()]);
        if (ignore) return;
        setOverview(ov);
        setFng(fg);
        // Le cache périmé (ov.stale) est un AVERTISSEMENT, pas une erreur : signalé
        // discrètement dans l'en-tête (« · cache »), l'état `error` reste réservé
        // aux échecs durs (catch) rendus dans un bloc d'erreur standard.
        setError(null);
      } catch (err) {
        if (ignore) return;
        setError(err instanceof Error ? err.message : "Vue marché indisponible.");
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    void load();
    const timer = setInterval(load, REFRESH_MS);
    // Catalogue Binance (une fois) pour valider la cible d'un clic (« sinon rien »).
    void fetchPairs("binance")
      .then((liste) => {
        if (!ignore) binancePairsRef.current = new Set(liste);
      })
      .catch(() => {
        /* best-effort : sans catalogue, le clic ne navigue simplement pas */
      });

    return () => {
      ignore = true;
      clearInterval(timer);
    };
  }, [open]);

  // — (Re)dimensionnement du canvas suivant son conteneur (ré-observe le conteneur
  // frais au retour sur l'onglet Carte, qui remonte un nouvel élément). —
  useEffect(() => {
    if (!open || tab !== "carte") return;
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      sizeRef.current = { w: rect.width, h: rect.height };
      setSizeTick((n) => n + 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, tab]);

  // — Calcul du layout + peinture (données / onglet / taille / thème) —
  useEffect(() => {
    if (!open || tab !== "carte") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { w, h } = sizeRef.current;
    if (w <= 0 || h <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);

    const tok = readTokens();
    const coins = (overview?.coins ?? []).slice(0, MAX_TILES);
    const conteneur: Rect = { x: 0, y: 0, w, h };
    layoutRef.current = squarify(coins, (c) => c.mcapUsd, conteneur);

    const paint = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const hover = hoverRef.current;
      layoutRef.current.forEach((t, i) => drawTile(ctx, t, tok, i === hover));
      const ht = hover >= 0 ? layoutRef.current[hover] : undefined;
      if (ht) drawTooltip(ctx, ht.item, mouseRef.current.x, mouseRef.current.y, w, h, tok);
    };
    paintRef.current = paint;
    paint();
  }, [open, tab, overview, sizeTick, themeId]);

  // — Interactions souris (hors state React : refs + rAF) —
  const scheduleRepaint = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => paintRef.current());
  }, []);

  const tuileSousCurseur = (ev: React.MouseEvent<HTMLCanvasElement>): number => {
    const canvas = canvasRef.current;
    if (!canvas) return -1;
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    mouseRef.current = { x, y };
    return layoutRef.current.findIndex(
      (t) => x >= t.rect.x && x < t.rect.x + t.rect.w && y >= t.rect.y && y < t.rect.y + t.rect.h,
    );
  };

  const onMove = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const idx = tuileSousCurseur(ev);
    // Repeindre si la tuile survolée change OU si un tooltip est actif (suit le curseur).
    if (idx !== hoverRef.current || idx >= 0) {
      hoverRef.current = idx;
      scheduleRepaint();
    }
  };

  const onLeave = () => {
    if (hoverRef.current !== -1) {
      hoverRef.current = -1;
      scheduleRepaint();
    }
  };

  const onClick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const idx = tuileSousCurseur(ev);
    const tuile = idx >= 0 ? layoutRef.current[idx] : undefined;
    if (!tuile) return;
    const pair = toBinanceUsdtPair(tuile.item.symbol);
    // « sinon rien » : on ne navigue que si la paire existe réellement chez Binance.
    if (binancePairsRef.current && binancePairsRef.current.has(pair)) {
      const m = marketStore.getState();
      m.setExchange("binance");
      m.setSymbol(pair);
    }
  };

  const g = overview?.global;

  return (
    // Conteneur pleine hauteur en colonne (calque sur GlobeWindow) : donne au corps `flex-1`
    // un parent à hauteur définie, sinon le canvas treemap est mesuré à ~0px et s'ouvre
    // écrasé en une seule bande (audit #28).
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-text">Vue marché</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-dim">
            <span>
              Cap. <span className="tabular-nums text-text">{formatUsd(g?.totalMcapUsd ?? NaN)}</span>{" "}
              {g && (
                <span className={g.mcapChangePct24h >= 0 ? "text-up" : "text-down"}>
                  {formatPct(g.mcapChangePct24h)}
                </span>
              )}
            </span>
            <span>
              BTC <span className="tabular-nums text-text">{g ? `${g.btcDominance.toFixed(1)}%` : "—"}</span> · ETH{" "}
              <span className="tabular-nums text-text">{g ? `${g.ethDominance.toFixed(1)}%` : "—"}</span>
            </span>
            <span>
              Vol 24h <span className="tabular-nums text-text">{formatUsd(g?.totalVolumeUsd ?? NaN)}</span>
            </span>
            {fng && (
              <span>
                F&amp;G <span className="tabular-nums text-text">{fng.value}</span>{" "}
                <span className="text-text-dim">{fng.classification}</span>
              </span>
            )}
            {overview && (
              <span className={overview.stale ? "text-amber-500" : "text-text-dim"}>
                {loading
                  ? "maj…"
                  : `maj ${formatAge(overview.fetchedAt, Date.now())}${overview.stale ? " · cache" : ""}`}
              </span>
            )}
          </div>
        </div>
        {/* Croix de fermeture retirée — fournie par le chrome FloatingWindow */}
      </header>

      {/* Onglets */}
      <Onglets
        options={[
          { id: "carte", label: "Carte" },
          { id: "secteurs", label: "Secteurs" },
        ]}
        actif={tab}
        onChange={setTab}
      />
      {error && (
        <div className="px-3 pt-2">
          <ErreurBloc>{error}</ErreurBloc>
        </div>
      )}

      {/* Corps */}
      {tab === "carte" ? (
        <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden">
          {(overview?.coins.length ?? 0) === 0 ? (
            <div className="flex h-full items-center justify-center text-[11px] text-text-dim">
              {loading ? "Chargement…" : "Carte indisponible."}
            </div>
          ) : (
            <canvas
              ref={canvasRef}
              onMouseMove={onMove}
              onMouseLeave={onLeave}
              onClick={onClick}
              className="block h-full w-full cursor-pointer"
            />
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          <SectorsTab overview={overview} />
        </div>
      )}

      {/* Source + cadence (note de bas de panneau standard) */}
      <div className="shrink-0 border-t border-border px-4 py-1.5">
        <NoteSource>Données CoinGecko + alternative.me, ~5 min.</NoteSource>
      </div>
    </div>
  );
}

// ─────────────────────────── Commandes palette (à enregistrer par l'intégrateur) ───────────────────────────

/**
 * Commandes exposées à la palette (⌘K) — l'intégrateur les enregistre via
 * `enregistrerCommandes(commandes)`. Mnémonique MAP (Bloomberg « heat map »), avec
 * un alias IMAP conservé (ancien mnémonique) pour ne pas casser les habitudes.
 */
export const commandes: Commande[] = [
  {
    id: "panneau:vue-marche",
    mnemonique: "MAP",
    libelle: "Vue marché (treemap)",
    categorie: "panneau",
    motsCles: ["vue marche", "market map", "treemap", "heatmap", "carte", "secteurs", "capitalisation", "imap"],
    apercu: "Ouvre / ferme la treemap de capitalisation du marché",
    action: () => marketMapUiStore.getState().toggleMarketMap(),
  },
  {
    id: "panneau:vue-marche-imap",
    mnemonique: "IMAP",
    libelle: "Vue marché (treemap)",
    categorie: "panneau",
    motsCles: ["vue marche", "market map", "treemap", "heatmap", "alias map"],
    apercu: "Alias de MAP — ouvre / ferme la treemap de capitalisation du marché",
    action: () => marketMapUiStore.getState().toggleMarketMap(),
  },
];
