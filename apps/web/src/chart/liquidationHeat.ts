/**
 * Grille 2D pure des liquidations : agrège les événements bruts (`LiqEvent`, Tâche 4) en
 * cellules (une BOUGIE × un BUCKET de prix) sur la plage visible, en séparant long/short.
 * C'est le moteur d'agrégation qui alimentera le contrôleur canvas de la heatmap (Tâche 6).
 *
 * Modèle : les événements sont conservés bruts ; le re-bucketing est gratuit, donc la taille
 * de bucket est RECALCULÉE à chaque construction depuis le close de la dernière bougie de la
 * plage (plus de taille figée). L'échelle d'intensité est LOGARITHMIQUE (log1p) pour relever
 * les petits niveaux face aux cascades massives.
 *
 * Toutes les fonctions ici sont PURES (aucun accès DOM/store/chart) et testées.
 */
import { ActionType, DomPosition } from "klinecharts";
import type { Chart, Point } from "klinecharts";
import type { Candle } from "@axiom/types";
import {
  tailleBucket,
  bucketIndex,
  candleContenant,
  couleurViridis,
  liqEventsStore,
  type LiqEvent,
} from "./liquidationMarkers";
import { marketStore } from "../store/market";

/** Cellule agrégée : une bougie × un bucket de prix. */
export interface LiqCell {
  candleTime: number;
  bucketIdx: number;
  longUsd: number;
  shortUsd: number;
  count: number;
}

/** Grille complète : cellules indexées par `${candleTime}:${bucketIdx}` + méta. */
export interface LiqGrid {
  cells: Map<string, LiqCell>;
  taille: number;
  maxUsd: number; // max(longUsd + shortUsd) sur les cellules
}

/**
 * Agrège les `events` en cellules (bougie × bucket) sur la plage de bougies [from, to)
 * (INDEX de bougies, convention `getVisibleRange`). La taille de bucket est dérivée du close
 * de la DERNIÈRE bougie de la plage ; chaque événement est rattaché à sa bougie contenante
 * (`candleContenant`), et les événements hors de [candles[from].time, candles[to-1].time]
 * sont écartés. Renvoie `null` si la plage contient < 1 bougie ou ne produit aucune cellule.
 * PURE.
 */
export function construireGrille(
  events: LiqEvent[],
  candles: Candle[],
  from: number,
  to: number,
): LiqGrid | null {
  if (to - from < 1) return null;
  const premier = candles[from];
  const dernier = candles[to - 1];
  if (premier === undefined || dernier === undefined) return null;

  const taille = tailleBucket(dernier.close);
  if (!(taille > 0)) return null;

  const cells = new Map<string, LiqCell>();
  for (const ev of events) {
    if (!(ev.price > 0) || !Number.isFinite(ev.usd)) continue;
    const c = candleContenant(candles, ev.time);
    if (c === undefined) continue;
    // Rattachement borné à la plage visible : les temps de bougie sont croissants, donc
    // c.time ∈ [premier.time, dernier.time] ⇔ index de la bougie ∈ [from, to).
    if (c.time < premier.time || c.time > dernier.time) continue;

    const bucketIdx = bucketIndex(ev.price, taille);
    const cle = `${c.time}:${bucketIdx}`;
    let cell = cells.get(cle);
    if (cell === undefined) {
      cell = { candleTime: c.time, bucketIdx, longUsd: 0, shortUsd: 0, count: 0 };
      cells.set(cle, cell);
    }
    if (ev.side === "long") cell.longUsd += ev.usd;
    else cell.shortUsd += ev.usd;
    cell.count += 1;
  }

  if (cells.size === 0) return null;

  let maxUsd = 0;
  for (const cell of cells.values()) {
    const total = cell.longUsd + cell.shortUsd;
    if (total > maxUsd) maxUsd = total;
  }

  return { cells, taille, maxUsd };
}

/**
 * Intensité log-normalisée ∈ [0,1] : `log1p(usd) / log1p(maxUsd)`, clampée. La log relève
 * les petits niveaux face aux cascades massives. Renvoie 0 si `maxUsd <= 0`. PURE.
 */
export function intensiteLog(usd: number, maxUsd: number): number {
  if (!(maxUsd > 0)) return 0;
  const t = Math.log1p(Math.max(0, usd)) / Math.log1p(maxUsd);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Profil latéral par bucket de prix : somme long/short de toutes les bougies pour chaque
 * bucketIdx (alimente les bandes du bord droit). PURE.
 */
export function profilParPrix(grid: LiqGrid): Map<number, { longUsd: number; shortUsd: number }> {
  const profil = new Map<number, { longUsd: number; shortUsd: number }>();
  for (const cell of grid.cells.values()) {
    let agg = profil.get(cell.bucketIdx);
    if (agg === undefined) {
      agg = { longUsd: 0, shortUsd: 0 };
      profil.set(cell.bucketIdx, agg);
    }
    agg.longUsd += cell.longUsd;
    agg.shortUsd += cell.shortUsd;
  }
  return profil;
}

// ─────────────────────────── Contrôleur canvas (non testé — couplage KLineChart) ───────────────────────────

/** Pane prix (id par défaut KLineChart). */
const CANDLE_PANE_ID = "candle_pane";
/** Largeur max des bandes latérales du profil = fraction de la largeur du pane prix. */
const MAX_BAND_FRAC = 0.12;
/** Largeur de repli d'une cellule quand la largeur de bougie n'est pas déductible. */
const FALLBACK_CELL_W = 6;

interface PixelXY {
  x?: number;
  y?: number;
}

/** Lit un token CSS sémantique concret depuis <html> (le canvas n'évalue pas var()). */
function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Contrôleur canvas de la HEATMAP de liquidations (bougie × bucket de prix). Remplace le
 * rendu overlay intérimaire : peint une grille 2D temps×prix (intensité log viridis) plus
 * un profil latéral long/short au bord droit. Même mécanique éprouvée que
 * `VolumeProfileController` : rAF + dirty flag, `subscribeAction` du viewport,
 * `convertToPixel`, ResizeObserver, clip du pane, DPR. Aucun re-render React.
 *
 * Source : le buffer d'événements bruts (`liqEventsStore`, alimenté par le singleton WS de
 * liquidationMarkers) agrégé à la volée sur la plage visible via `construireGrille`.
 */
export class LiquidationHeatController {
  private readonly chart: Chart;
  private readonly container: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  private running = false;
  private raf = 0;
  /** Reconstruit/redessine seulement si dirty : évite un recalcul complet à 60 fps au repos. */
  private dirty = true;
  private resizeObserver: ResizeObserver | null = null;
  private unsubMarket: (() => void) | null = null;
  private unsubEvents: (() => void) | null = null;

  private readonly markDirty = (): void => {
    this.dirty = true;
  };

  constructor(chart: Chart, container: HTMLElement, canvas: HTMLCanvasElement) {
    this.chart = chart;
    this.container = container;
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Contexte 2D du canvas heatmap-liquidations indisponible");
    this.ctx = ctx;
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.running) return;
    if (enabled) this.start();
    else this.stop();
  }

  dispose(): void {
    this.stop();
  }

  private start(): void {
    this.running = true;
    this.dirty = true;
    this.canvas.style.display = "block";
    this.subscribeActions();
    // Nouvelle bougie / backfill : le buffer marché change → recalcul. Le flux de
    // liquidations (buffer d'événements) est publié dans `liqEventsStore` par le singleton
    // WS de liquidationMarkers : on suit sa révision pour repeindre au fil des liquidations.
    this.unsubMarket = marketStore.subscribe(this.markDirty);
    this.unsubEvents = liqEventsStore.subscribe(this.markDirty);
    // Redimensionnement du conteneur (resize fenêtre, toggle sidebar…) : aucun
    // scroll/zoom/tick ne le signale autrement, d'où l'observer dédié.
    this.resizeObserver = new ResizeObserver(this.markDirty);
    this.resizeObserver.observe(this.container);
    this.loop();
  }

  private stop(): void {
    this.running = false;
    this.canvas.style.display = "none";
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.unsubscribeActions();
    this.unsubMarket?.();
    this.unsubMarket = null;
    this.unsubEvents?.();
    this.unsubEvents = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.clearCanvas();
  }

  private readonly onViewport = (): void => {
    this.markDirty();
    this.render();
  };

  private subscribeActions(): void {
    this.chart.subscribeAction(ActionType.OnScroll, this.onViewport);
    this.chart.subscribeAction(ActionType.OnZoom, this.onViewport);
    this.chart.subscribeAction(ActionType.OnVisibleRangeChange, this.onViewport);
  }

  private unsubscribeActions(): void {
    this.chart.unsubscribeAction(ActionType.OnScroll, this.onViewport);
    this.chart.unsubscribeAction(ActionType.OnZoom, this.onViewport);
    this.chart.unsubscribeAction(ActionType.OnVisibleRangeChange, this.onViewport);
  }

  private readonly loop = (): void => {
    if (this.dirty) this.render();
    this.raf = requestAnimationFrame(this.loop);
  };

  private toPx(p: Partial<Point>): PixelXY {
    return this.chart.convertToPixel(p, {
      paneId: CANDLE_PANE_ID,
      absolute: true,
    }) as PixelXY;
  }

  private clearCanvas(): void {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, this.container.clientWidth, this.container.clientHeight);
  }

  private render(): void {
    if (!this.running) return;
    this.dirty = false; // consommé : la prochaine frame ne refera rien tant que rien ne change.
    const ctx = this.ctx;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssW = this.container.clientWidth;
    const cssH = this.container.clientHeight;
    const bw = Math.round(cssW * dpr);
    const bh = Math.round(cssH * dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
      this.canvas.style.width = `${cssW}px`;
      this.canvas.style.height = `${cssH}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const main = this.chart.getSize(CANDLE_PANE_ID, DomPosition.Main);
    if (!main) return;
    const { left, top, width, height } = main;
    const xRight = left + width;

    // Légende discrète (toujours affichée quand le heatmap est actif).
    const dim = readToken("--text-dim") || "#9ca3af";
    ctx.fillStyle = dim;
    ctx.font = "10px ui-monospace, SFMono-Regular, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText("Liq heatmap (exécutées) · log", xRight - 4, top + 4);

    const { events, enAttente } = liqEventsStore.getState();
    const candles = marketStore.getState().candles;
    const range = this.chart.getVisibleRange();
    const from = Math.max(0, range.from);
    const to = Math.min(candles.length, range.to);

    const grid = to - from >= 1 ? construireGrille(events, candles, from, to) : null;

    // Buffer vide (heatmap actif mais aucune liquidation encore reçue) : indicateur « en
    // attente » discret, décalé SOUS la légende (remplace l'overlay `liqHint`).
    if (grid === null) {
      if (enAttente) {
        ctx.fillStyle = "rgba(130,130,150,0.95)";
        ctx.fillText("⋯ Heatmap liquidations active — en attente du flux live", xRight - 4, top + 18);
      }
      return;
    }

    // Largeur de bougie par temps : x(bougie suivante) − x(bougie), min 1px ; la dernière
    // bougie visible réutilise la largeur de l'avant-dernière (ou 6px). Cellule CENTRÉE sur x.
    const largeurs = new Map<number, { x: number; w: number }>();
    let prevW = FALLBACK_CELL_W;
    for (let i = from; i < to; i++) {
      const c = candles[i];
      if (c === undefined) continue;
      const x = this.toPx({ timestamp: c.time }).x;
      if (x === undefined || !Number.isFinite(x)) continue;
      const suivant = i + 1 < to ? candles[i + 1] : undefined;
      let w = prevW;
      if (suivant !== undefined) {
        const xn = this.toPx({ timestamp: suivant.time }).x;
        if (xn !== undefined && Number.isFinite(xn)) w = Math.max(1, xn - x);
      }
      prevW = w;
      largeurs.set(c.time, { x, w });
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();

    // Cellules : un rect par (bougie × bucket), couleur viridis d'intensité log, alpha croissant.
    for (const cell of grid.cells.values()) {
      const col = largeurs.get(cell.candleTime);
      if (col === undefined) continue;
      const yTop = this.toPx({ value: (cell.bucketIdx + 1) * grid.taille }).y;
      const yBot = this.toPx({ value: cell.bucketIdx * grid.taille }).y;
      if (yTop === undefined || yBot === undefined || !Number.isFinite(yTop) || !Number.isFinite(yBot)) {
        continue;
      }
      const t = intensiteLog(cell.longUsd + cell.shortUsd, grid.maxUsd);
      const [r, g, b] = couleurViridis(t);
      const yT = Math.min(yTop, yBot);
      const h = Math.max(1, Math.abs(yBot - yTop));
      ctx.fillStyle = `rgba(${r},${g},${b},${(0.25 + 0.55 * t).toFixed(3)})`;
      ctx.fillRect(col.x - col.w / 2, yT, col.w, h);
    }

    // Bandes latérales du profil par prix (bord droit) : largeur ∝ intensité log (max 12 %
    // du pane), SPLIT proportionnel — shorts liquidés (rachats forcés) teinte `--up` à
    // gauche, longs liquidés (ventes forcées) teinte `--down` collés au bord droit.
    const profil = profilParPrix(grid);
    let maxProfil = 0;
    for (const agg of profil.values()) {
      const total = agg.longUsd + agg.shortUsd;
      if (total > maxProfil) maxProfil = total;
    }
    if (maxProfil > 0) {
      const maxBandW = width * MAX_BAND_FRAC;
      const up = readToken("--up") || "#10b981";
      const down = readToken("--down") || "#ef4444";
      for (const [idx, agg] of profil) {
        const total = agg.longUsd + agg.shortUsd;
        if (total <= 0) continue;
        const yTop = this.toPx({ value: (idx + 1) * grid.taille }).y;
        const yBot = this.toPx({ value: idx * grid.taille }).y;
        if (yTop === undefined || yBot === undefined || !Number.isFinite(yTop) || !Number.isFinite(yBot)) {
          continue;
        }
        const yT = Math.min(yTop, yBot);
        const h = Math.max(1, Math.abs(yBot - yTop));
        const w = intensiteLog(total, maxProfil) * maxBandW;
        const longW = w * (agg.longUsd / total);
        const shortW = w - longW;
        // longs (--down) collés au bord droit, shorts (--up) à leur gauche. globalAlpha
        // plutôt qu'une couleur rgba pré-calculée : robuste quel que soit le format du token
        // de thème (hex, rgb() ou oklch), comme le fait le Volume Profile.
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = down;
        ctx.fillRect(xRight - longW, yT, longW, h);
        ctx.fillStyle = up;
        ctx.fillRect(xRight - longW - shortW, yT, shortW, h);
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }
}
