/**
 * Panneau « Carnet d'ordres » (DOM) — dockable à droite, NON MODAL (pas d'overlay).
 *
 * Trois onglets, TOUS rendus en canvas impératif (refs + rAF throttlé ~15 fps) :
 *   • LADDER : échelle de prix verticale centrée sur le mid ; tailles bid/ask en barres
 *              horizontales, agrégées par pas de prix ; murs de liquidité surlignés.
 *   • DEPTH  : profondeur cumulée bid/ask en courbes d'escalier (tokens up/down).
 *   • TAPE   : time & sales défilant (heure, prix, taille, agresseur coloré ; gros
 *              trades surlignés au-delà d'un seuil configurable).
 *
 * AUCUN re-render React sur message : le carnet et les trades vivent hors React
 * (livreRef / tradesRef), peints en rAF. Seuls symbole, onglet, pas et seuil (basse
 * fréquence) passent par les stores/state. Binance UNIQUEMENT (les autres sources
 * affichent « non disponible »). Budget WS : UNE connexion à la fois — depth pour
 * LADDER/DEPTH, trades (réutilise binanceAdapter.subscribeTrades) pour la TAPE.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { Trade } from "@axiom/types";
import { marketStore } from "../store/market";
import { themeStore } from "../store/theme";
import { domUiStore, FACTEURS_PAS, SEUILS_GROS_TRADE } from "../store/dom-ui";
import { binanceAdapter } from "../data/binance";
import {
  agregerNiveaux,
  mediane,
  meilleursNiveaux,
  pasArrondi,
  profondeurCumulee,
  souscrireDepth,
  type NiveauAgrege,
  type Niveau,
  type OrderBook,
} from "../data/depth";
import { formatUsd } from "../lib/format";
import { lireTokensCanvas } from "../lib/canvasTokens";
import { EnTeteFenetre, Onglets, Vide } from "./ui";

/** Nombre MAX de niveaux affichés de chaque côté du mid (LADDER, fenêtre haute). */
const LADDER_ROWS = 20;
/** Hauteur de ligne plancher du ladder (px) : au-dessus de la police 11px pour
 *  éviter le télescopage des prix/tailles sur fenêtre courte (audit #8). */
const ROW_H_MIN = 13;
/** Un niveau est un « mur » si sa taille dépasse ce facteur × la médiane visible. */
const WALL_FACTOR = 4;
/** Demi-fenêtre de prix du depth chart autour du mid (±1 %). */
const DEPTH_WINDOW_PCT = 0.01;
/** Trades conservés en mémoire (tape défilante). */
const TAPE_MAX = 200;
/** Hauteur d'une ligne de la tape (px). */
const TAPE_ROW_H = 16;
/** Cadence de peinture max (~15 fps) : throttle du rAF. */
const MIN_FRAME_MS = 66;

// ─────────────────────────── Couleurs (tokens de thème) ───────────────────────────

type Rgb = [number, number, number];

interface Tokens {
  up: Rgb;
  down: Rgb;
  text: Rgb;
  textDim: Rgb;
  border: Rgb;
  surface: Rgb;
  bg: Rgb;
  /** Thème clair (fond lumineux) : les barres de profondeur ont besoin de plus
   *  d'opacité pour préserver la teinte bid/ask (audit #19). */
  clair: boolean;
}

/** Luminance perçue (0–1) d'une couleur RVB. */
function luminance(c: Rgb): number {
  return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
}

/** Parse « #rrggbb » (ou « #rgb ») en composantes RVB ; gris moyen par défaut. */
function hexToRgb(hex: string): Rgb {
  const h = hex.trim().replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const int = Number.parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(int)) return [128, 128, 128];
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

/** Lit les tokens de couleur du thème courant (relu à chaque changement de thème). */
function readTokens(): Tokens {
  // Lecture mutualisée des variables CSS ; hexToRgb reste local (le canvas a
  // besoin de tuples RVB pour composer les alphas via rgba()).
  const raw = lireTokensCanvas([
    "--up",
    "--down",
    "--text",
    "--text-dim",
    "--border",
    "--surface",
    "--bg",
  ] as const);
  const bg = hexToRgb(raw["--bg"]);
  return {
    up: hexToRgb(raw["--up"]),
    down: hexToRgb(raw["--down"]),
    text: hexToRgb(raw["--text"]),
    textDim: hexToRgb(raw["--text-dim"]),
    border: hexToRgb(raw["--border"]),
    surface: hexToRgb(raw["--surface"]),
    bg,
    clair: luminance(bg) > 0.5,
  };
}

function rgbCss(c: Rgb): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function rgba(c: Rgb, a: number): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

// ─────────────────────────── Formatage ───────────────────────────

/** Nombre de décimales à afficher pour un pas de prix donné. */
function decimalesPas(pas: number): number {
  if (!(pas > 0)) return 2;
  if (pas >= 1) return 0;
  return Math.min(8, Math.ceil(-Math.log10(pas)));
}

/** Décimales adaptées à la magnitude d'un prix (pour la TAPE). */
function decimalesPrix(prix: number): number {
  const abs = Math.abs(prix);
  if (abs >= 1000) return 1;
  if (abs >= 1) return 2;
  if (abs >= 0.01) return 4;
  return 6;
}

function formatPrix(prix: number, dec: number): string {
  return Number.isFinite(prix) ? prix.toFixed(dec) : "—";
}

/** Quantité (base) compacte : 12.3M / 4.56K / 1.23 / 0.0456. */
function formatQte(q: number): string {
  if (!Number.isFinite(q)) return "";
  const abs = Math.abs(q);
  if (abs >= 1_000_000) return `${(q / 1e6).toFixed(2)}M`;
  if (abs >= 1_000) return `${(q / 1e3).toFixed(2)}K`;
  if (abs >= 1) return q.toFixed(2);
  return q.toFixed(4);
}

// Notionnel USD compact : migré vers lib/format (formatUsd partagé). L'heure du
// tape reste locale (heureTape) : chemin chaud canvas, voir sa docstring.

/**
 * Heure « HH:MM:SS » construite à la main pour le canvas du tape : appelée par
 * LIGNE À CHAQUE FRAME, là où formatHeure (Intl.toLocaleTimeString) serait trop
 * coûteux. Rendu identique au format partagé (exception perf assumée).
 */
function heureTape(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ─────────────────────────── Aides carnet ───────────────────────────

/** Convertit une Map prix→qté en tableau de niveaux bruts. */
function niveauxDepuisMap(map: Map<number, number>): Niveau[] {
  const out: Niveau[] = [];
  for (const [prix, qte] of map) out.push([prix, qte]);
  return out;
}

// ─────────────────────────── Dessin ───────────────────────────

/** Message centré (canvas vide : en attente / indisponible). */
function placeholder(ctx: CanvasRenderingContext2D, w: number, h: number, tk: Tokens, txt: string): void {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = rgbCss(tk.textDim);
  ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(txt, w / 2, h / 2);
}

type LigneLadder = NiveauAgrege & { cote: "bid" | "ask" };

/** LADDER : échelle verticale centrée sur le mid, barres bid/ask + murs surlignés. */
function dessinerLadder(ctx: CanvasRenderingContext2D, w: number, h: number, livre: OrderBook, pas: number, tk: Tokens): void {
  const best = meilleursNiveaux(livre);
  if (!best) return placeholder(ctx, w, h, tk, "Chargement…");

  // Nombre de niveaux par côté DÉRIVÉ de la hauteur réelle (plancher ROW_H_MIN),
  // borné par LADDER_ROWS : sur fenêtre courte on affiche moins de niveaux plutôt
  // que de tasser 40 lignes sous la police (audit #8).
  const perSide = Math.max(2, Math.min(LADDER_ROWS, Math.floor(h / 2 / ROW_H_MIN)));
  const bids = agregerNiveaux(niveauxDepuisMap(livre.bids), pas, "bid", perSide);
  const asks = agregerNiveaux(niveauxDepuisMap(livre.asks), pas, "ask", perSide);
  if (bids.length === 0 && asks.length === 0) return placeholder(ctx, w, h, tk, "Chargement…");

  ctx.clearRect(0, 0, w, h);

  // Ordre haut→bas : asks (plus haut prix en haut) puis bids.
  const rows: LigneLadder[] = [
    ...asks.map((n): LigneLadder => ({ ...n, cote: "ask" })).reverse(),
    ...bids.map((n): LigneLadder => ({ ...n, cote: "bid" })),
  ];
  const rowH = Math.min(26, h / Math.max(rows.length, 1));
  const maxQte = Math.max(1, ...rows.map((r) => r.qte));
  const med = mediane(rows.map((r) => r.qte));
  const seuilMur = med * WALL_FACTOR;

  const dec = decimalesPas(pas);
  const priceW = Math.min(96, w * 0.34);
  const barX = priceW;
  const barW = Math.max(0, w - priceW - 8);

  ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textBaseline = "middle";

  rows.forEach((r, i) => {
    const y = i * rowH;
    const cy = y + rowH / 2;
    const coul = r.cote === "bid" ? tk.up : tk.down;
    const mur = med > 0 && r.qte >= seuilMur;

    const bw = (r.qte / maxQte) * barW;
    // Thème clair : barres plus opaques pour garder la teinte bid(vert)/ask(rouge)
    // sur fond pastel où 0.22 se désature en gris (audit #19).
    ctx.fillStyle = rgba(coul, mur ? (tk.clair ? 0.6 : 0.5) : tk.clair ? 0.4 : 0.22);
    ctx.fillRect(barX, y + 1, bw, rowH - 2);
    if (mur) {
      ctx.strokeStyle = rgbCss(coul);
      ctx.lineWidth = 1;
      ctx.strokeRect(barX + 0.5, y + 1.5, Math.max(0, bw - 1), rowH - 3);
    }

    ctx.fillStyle = rgbCss(coul);
    ctx.textAlign = "left";
    ctx.fillText(formatPrix(r.prix, dec), 4, cy);
    ctx.fillStyle = rgbCss(tk.text);
    ctx.textAlign = "right";
    ctx.fillText(formatQte(r.qte), w - 4, cy);
  });

  // Ligne du mid entre asks et bids + étiquette mid · spread.
  const midY = asks.length * rowH;
  ctx.strokeStyle = rgba(tk.textDim, 0.6);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(w, midY);
  ctx.stroke();

  const spread = best.bestAsk - best.bestBid;
  const label = `${formatPrix(best.mid, dec)}  ·  spread ${formatPrix(spread, dec)}`;
  ctx.font = "600 11px ui-monospace, monospace";
  const lw = ctx.measureText(label).width + 12;
  const lx = w / 2 - lw / 2;
  ctx.fillStyle = rgba(tk.bg, 0.96);
  ctx.fillRect(lx, midY - 8, lw, 16);
  ctx.strokeStyle = rgba(tk.textDim, 0.6);
  ctx.strokeRect(lx + 0.5, midY - 7.5, lw - 1, 15);
  ctx.fillStyle = rgbCss(tk.text);
  ctx.textAlign = "center";
  ctx.fillText(label, w / 2, midY);
}

/** Tracé d'une courbe d'escalier de profondeur (aire fermée vers la baseline). */
function tracerMarche(
  ctx: CanvasRenderingContext2D,
  pts: { prix: number; cumul: number }[],
  xOf: (prix: number) => number,
  yOf: (cumul: number) => number,
  midX: number,
  baseY: number,
  coul: Rgb,
): void {
  const dernier = pts.at(-1);
  if (dernier === undefined) return;
  ctx.beginPath();
  ctx.moveTo(midX, baseY);
  let prevY = baseY;
  for (const pt of pts) {
    const x = xOf(pt.prix);
    ctx.lineTo(x, prevY); // horizontal jusqu'au prix
    const y = yOf(pt.cumul);
    ctx.lineTo(x, y); // vertical au nouveau cumul
    prevY = y;
  }
  ctx.lineTo(xOf(dernier.prix), baseY);
  ctx.closePath();
  ctx.fillStyle = rgba(coul, 0.18);
  ctx.fill();
  ctx.strokeStyle = rgbCss(coul);
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/** DEPTH : profondeur cumulée bid/ask en escalier autour du mid. */
function dessinerDepth(ctx: CanvasRenderingContext2D, w: number, h: number, livre: OrderBook, tk: Tokens): void {
  const best = meilleursNiveaux(livre);
  if (!best) return placeholder(ctx, w, h, tk, "Chargement…");

  const { mid } = best;
  const pMin = mid * (1 - DEPTH_WINDOW_PCT);
  const pMax = mid * (1 + DEPTH_WINDOW_PCT);
  const bids = profondeurCumulee(niveauxDepuisMap(livre.bids), "bid").filter((p) => p.prix >= pMin);
  const asks = profondeurCumulee(niveauxDepuisMap(livre.asks), "ask").filter((p) => p.prix <= pMax);
  if (bids.length === 0 && asks.length === 0) return placeholder(ctx, w, h, tk, "Profondeur indisponible.");

  ctx.clearRect(0, 0, w, h);

  const maxCum = Math.max(1, bids.at(-1)?.cumul ?? 0, asks.at(-1)?.cumul ?? 0);
  const baseY = h - 4;
  const xOf = (prix: number) => ((prix - pMin) / (pMax - pMin)) * w;
  const yOf = (cumul: number) => baseY - (cumul / maxCum) * (h - 24);
  const midX = xOf(mid);

  tracerMarche(ctx, bids, xOf, yOf, midX, baseY, tk.up);
  tracerMarche(ctx, asks, xOf, yOf, midX, baseY, tk.down);

  // Ligne verticale du mid.
  ctx.strokeStyle = rgba(tk.textDim, 0.5);
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(midX, 0);
  ctx.lineTo(midX, baseY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Repères d'axes : bornes de prix + profondeur max.
  const dec = decimalesPas(pasArrondi(mid));
  ctx.font = "10px ui-monospace, monospace";
  ctx.fillStyle = rgbCss(tk.textDim);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillText(formatPrix(pMin, dec), 4, 4);
  ctx.textAlign = "right";
  ctx.fillText(formatPrix(pMax, dec), w - 4, 4);
  ctx.textAlign = "center";
  ctx.fillText(`Σ ${formatQte(maxCum)}`, midX, 4);
}

/** TAPE : time & sales défilant (heure, prix, taille, agresseur coloré). */
function dessinerTape(ctx: CanvasRenderingContext2D, w: number, h: number, trades: Trade[], seuil: number, tk: Tokens): void {
  if (trades.length === 0) return placeholder(ctx, w, h, tk, "Aucune transaction reçue.");
  ctx.clearRect(0, 0, w, h);

  const nRows = Math.max(1, Math.floor(h / TAPE_ROW_H));
  const recents = trades.slice(-nRows).reverse(); // plus récent en haut
  ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textBaseline = "middle";
  const xPrix = w * 0.62;

  recents.forEach((t, i) => {
    const y = i * TAPE_ROW_H;
    const cy = y + TAPE_ROW_H / 2;
    const coul = t.side === "buy" ? tk.up : tk.down;
    const gros = t.price * t.qty >= seuil;
    if (gros) {
      ctx.fillStyle = rgba(coul, 0.22);
      ctx.fillRect(0, y, w, TAPE_ROW_H);
    }
    ctx.fillStyle = rgbCss(tk.textDim);
    ctx.textAlign = "left";
    ctx.fillText(heureTape(t.time), 4, cy);
    ctx.fillStyle = rgbCss(coul);
    ctx.textAlign = "right";
    ctx.fillText(formatPrix(t.price, decimalesPrix(t.price)), xPrix, cy);
    ctx.fillStyle = gros ? rgbCss(tk.text) : rgbCss(coul);
    ctx.fillText(formatQte(t.qty), w - 4, cy);
  });
}

// ─────────────────────────── Composant ───────────────────────────

export function DomWindow() {
  const open = useStore(domUiStore, (s) => s.open);
  const tab = useStore(domUiStore, (s) => s.tab);
  const setTab = useStore(domUiStore, (s) => s.setTab);
  const facteurPas = useStore(domUiStore, (s) => s.facteurPas);
  const setFacteurPas = useStore(domUiStore, (s) => s.setFacteurPas);
  const seuilGrosTrade = useStore(domUiStore, (s) => s.seuilGrosTrade);
  const setSeuilGrosTrade = useStore(domUiStore, (s) => s.setSeuilGrosTrade);
  const exchange = useStore(marketStore, (s) => s.exchange);
  const symbol = useStore(marketStore, (s) => s.symbol);
  const themeId = useStore(themeStore, (s) => s.theme); // redessine au changement de thème

  const isBinance = exchange === "binance";

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const livreRef = useRef<OrderBook | null>(null);
  const tradesRef = useRef<Trade[]>([]);
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const paintRef = useRef<() => void>(() => {});
  const rafRef = useRef<number>(0);
  const lastPaintRef = useRef<number>(0);
  const [sizeTick, setSizeTick] = useState(0);

  // Peinture throttlée à ~15 fps (hors state React) : re-planifie le rAF tant que la
  // trame minimale n'est pas écoulée ; ne tourne que lorsqu'une donnée arrive.
  const scheduleRepaint = useCallback(() => {
    if (rafRef.current) return;
    const run = () => {
      const now = performance.now();
      if (now - lastPaintRef.current < MIN_FRAME_MS) {
        rafRef.current = requestAnimationFrame(run);
        return;
      }
      rafRef.current = 0;
      lastPaintRef.current = now;
      paintRef.current();
    };
    rafRef.current = requestAnimationFrame(run);
  }, []);

  // — Souscription DEPTH (onglets LADDER/DEPTH) : UNE connexion @depth@100ms. —
  useEffect(() => {
    if (!open || !isBinance || (tab !== "ladder" && tab !== "depth")) return;
    livreRef.current = null;
    const unsub = souscrireDepth(symbol, (livre) => {
      livreRef.current = livre;
      scheduleRepaint();
    });
    return () => {
      unsub();
      livreRef.current = null;
    };
  }, [open, isBinance, tab, symbol, scheduleRepaint]);

  // — Souscription TRADES (onglet TAPE) : réutilise binanceAdapter.subscribeTrades. —
  useEffect(() => {
    if (!open || !isBinance || tab !== "tape") return;
    tradesRef.current = [];
    const unsub = binanceAdapter.subscribeTrades(symbol, (t) => {
      const arr = tradesRef.current;
      arr.push(t);
      if (arr.length > TAPE_MAX) arr.splice(0, arr.length - TAPE_MAX);
      scheduleRepaint();
    });
    return () => {
      unsub();
      tradesRef.current = [];
    };
  }, [open, isBinance, tab, symbol, scheduleRepaint]);

  // — (Re)dimensionnement du canvas suivant son conteneur. —
  useEffect(() => {
    if (!open) return;
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      sizeRef.current = { w: rect.width, h: rect.height };
      setSizeTick((n) => n + 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, tab, isBinance]);

  // — Configuration du canvas + définition de la peinture (onglet / taille / thème / réglages). —
  useEffect(() => {
    if (!open || !isBinance) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h } = sizeRef.current;
    if (w <= 0 || h <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const tk = readTokens();

    const paint = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const livre = livreRef.current;
      if (tab === "tape") {
        dessinerTape(ctx, w, h, tradesRef.current, seuilGrosTrade, tk);
      } else if (!livre) {
        placeholder(ctx, w, h, tk, "Chargement…");
      } else if (tab === "ladder") {
        const pas = pasArrondi(meilleursNiveaux(livre)?.mid ?? 0) * facteurPas;
        dessinerLadder(ctx, w, h, livre, pas, tk);
      } else {
        dessinerDepth(ctx, w, h, livre, tk);
      }
    };
    paintRef.current = paint;
    paint();
  }, [open, isBinance, tab, sizeTick, themeId, facteurPas, seuilGrosTrade, symbol]);

  // Nettoyage du rAF au démontage.
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  return (
    // Panneau dockable à droite, NON MODAL (cf. DerivativesWindow). z-40.
    <>
      {/* En-tête standard ; la croix de fermeture est fournie par le chrome FloatingWindow. */}
      <EnTeteFenetre
        mnemo="DOM"
        titre="Carnet d'ordres"
        sousTitre={isBinance ? `${symbol} · Binance` : "Binance uniquement"}
      />

      <Onglets
        options={[
          { id: "ladder", label: "Ladder" },
          { id: "depth", label: "Depth" },
          { id: "tape", label: "Tape" },
        ] as const}
        actif={tab}
        onChange={setTab}
      />

      {/* Réglages contextuels : pas d'agrégation (ladder/depth) ou seuil gros trade (tape). */}
      {isBinance && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-1.5 text-[11px] text-text-dim">
          {tab === "tape" ? (
            <>
              <span className="mr-1">Gros trade &gt;</span>
              {SEUILS_GROS_TRADE.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSeuilGrosTrade(s)}
                  aria-pressed={seuilGrosTrade === s}
                  className={`rounded border px-1.5 py-0.5 tabular-nums transition ${
                    seuilGrosTrade === s ? "border-border bg-bg text-text" : "border-border hover:text-text"
                  }`}
                >
                  {formatUsd(s)}
                </button>
              ))}
            </>
          ) : (
            <>
              <span className="mr-1">Pas ×</span>
              {FACTEURS_PAS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFacteurPas(f)}
                  aria-pressed={facteurPas === f}
                  className={`rounded border px-1.5 py-0.5 tabular-nums transition ${
                    facteurPas === f ? "border-border bg-bg text-text" : "border-border hover:text-text"
                  }`}
                >
                  {f}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {/* Corps : canvas (Binance) ou message d'indisponibilité. */}
      <div ref={containerRef} className="relative flex-1 overflow-hidden">
        {isBinance ? (
          <canvas ref={canvasRef} className="block h-full w-full" />
        ) : (
          <div className="px-4 py-4">
            <Vide>
              Carnet d'ordres non disponible pour cette source — DOM, depth chart et time &amp; sales sont
              réservés à Binance.
            </Vide>
          </div>
        )}
      </div>
    </>
  );
}
