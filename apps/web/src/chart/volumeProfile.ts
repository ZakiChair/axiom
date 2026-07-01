/**
 * Volume Profile (VPVR — Visible Range) : histogramme du volume PAR NIVEAU DE PRIX
 * sur la plage visible du graphe. Répond au besoin « voir les volumes par zone de
 * prix » : on voit à quels prix le volume s'est concentré (POC = niveau le plus
 * tradé, Value Area = zone des 70 %).
 *
 * Source : les bougies OHLCV déjà en mémoire (marketStore) — donc GRATUIT et
 * valable pour TOUTES les sources (Binance/Kraken/Coinbase), pas seulement le flux
 * tick. Le volume d'une bougie est réparti uniformément sur son intervalle
 * [low, high] dans les bins de prix (approximation VP standard).
 *
 * Rendu : Canvas 2D superposé au pane prix, ancré au bord DROIT, synchronisé au
 * viewport via convertToPixel + subscribeAction + rAF (même technique éprouvée que
 * l'orderflow, alignement prouvé par le spike M4). Aucun re-render React.
 */
import { ActionType, DomPosition } from "klinecharts";
import type { Chart, Point } from "klinecharts";
import type { Candle } from "@axiom/types";
import { marketStore } from "../store/market";

/** Pane prix (id par défaut KLineChart). */
const CANDLE_PANE_ID = "candle_pane";
/** Nombre de bins de prix du profil. */
const BIN_COUNT = 100;
/** Largeur max de l'histogramme = fraction de la largeur du pane prix. */
const MAX_WIDTH_FRAC = 0.32;

interface PixelXY {
  x?: number;
  y?: number;
}

/** Un bin de prix du profil. */
export interface VpBin {
  priceLow: number;
  priceHigh: number;
  volume: number;
  buyVol: number;
  sellVol: number;
}

/** Résultat complet d'un profil de volume. */
export interface VolumeProfile {
  bins: VpBin[];
  priceMin: number;
  priceMax: number;
  maxVol: number;
  pocIndex: number; // index du Point of Control dans `bins`
  vaLow: number; // borne basse de la Value Area 70 %
  vaHigh: number; // borne haute de la Value Area 70 %
}

/**
 * Calcule le profil de volume sur les bougies d'index [from, to). Le volume de
 * chaque bougie est réparti uniformément sur [low, high] entre les bins couverts ;
 * le split buy/sell utilise `buyVolume`/`sellVolume` quand ils existent (Binance),
 * sinon une approximation par le sens de la bougie (close ≥ open => acheteur).
 */
export function computeVolumeProfile(
  candles: Candle[],
  from: number,
  to: number,
  binCount: number
): VolumeProfile | null {
  let priceMin = Infinity;
  let priceMax = -Infinity;
  for (let i = from; i < to; i++) {
    const c = candles[i];
    if (c === undefined) continue;
    if (c.low < priceMin) priceMin = c.low;
    if (c.high > priceMax) priceMax = c.high;
  }
  if (!Number.isFinite(priceMin) || !Number.isFinite(priceMax) || priceMax <= priceMin) {
    return null;
  }

  const span = priceMax - priceMin;
  const binSize = span / binCount;
  const bins: VpBin[] = new Array(binCount);
  for (let b = 0; b < binCount; b++) {
    bins[b] = {
      priceLow: priceMin + b * binSize,
      priceHigh: priceMin + (b + 1) * binSize,
      volume: 0,
      buyVol: 0,
      sellVol: 0,
    };
  }

  for (let i = from; i < to; i++) {
    const c = candles[i];
    if (c === undefined) continue;
    // Bins couverts par la bougie.
    const loIdx = Math.max(0, Math.floor((c.low - priceMin) / binSize));
    const hiIdx = Math.min(binCount - 1, Math.floor((c.high - priceMin) / binSize));
    const spread = hiIdx - loIdx + 1;
    const volPerBin = c.volume / spread;
    // Split buy/sell : champs taker si présents, sinon sens de la bougie.
    const buy = c.buyVolume ?? (c.close >= c.open ? c.volume : 0);
    const sell = c.sellVolume ?? (c.close >= c.open ? 0 : c.volume);
    const buyPerBin = buy / spread;
    const sellPerBin = sell / spread;
    for (let b = loIdx; b <= hiIdx; b++) {
      const bin = bins[b];
      if (bin === undefined) continue;
      bin.volume += volPerBin;
      bin.buyVol += buyPerBin;
      bin.sellVol += sellPerBin;
    }
  }

  // POC + volume total.
  let pocIndex = 0;
  let maxVol = 0;
  let total = 0;
  for (let b = 0; b < binCount; b++) {
    const bin = bins[b];
    if (bin === undefined) continue;
    total += bin.volume;
    if (bin.volume > maxVol) {
      maxVol = bin.volume;
      pocIndex = b;
    }
  }
  if (maxVol <= 0) return null;

  // Value Area 70 % : expansion gloutonne autour du POC.
  const target = total * 0.7;
  let lo = pocIndex;
  let hi = pocIndex;
  let acc = bins[pocIndex]?.volume ?? 0;
  while (acc < target && (lo > 0 || hi < binCount - 1)) {
    const up = hi + 1 <= binCount - 1 ? bins[hi + 1] : undefined;
    const dn = lo - 1 >= 0 ? bins[lo - 1] : undefined;
    const upVol = up ? up.volume : -1;
    const dnVol = dn ? dn.volume : -1;
    if (up !== undefined && upVol >= dnVol) {
      hi += 1;
      acc += upVol;
    } else if (dn !== undefined) {
      lo -= 1;
      acc += dnVol;
    } else {
      break;
    }
  }

  return {
    bins,
    priceMin,
    priceMax,
    maxVol,
    pocIndex,
    vaLow: bins[lo]?.priceLow ?? priceMin,
    vaHigh: bins[hi]?.priceHigh ?? priceMax,
  };
}

/** Lit un token CSS sémantique concret depuis <html> (le canvas n'évalue pas var()). */
function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Contrôleur Volume Profile lié à UNE instance Chart + un canvas overlay dédié.
 * S'active/désactive via le bouton « Profil Vol ». Recalcule à chaque frame depuis
 * le buffer marketStore (peu coûteux : ~100 bins) ; le rendu suit le viewport.
 */
export class VolumeProfileController {
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

  private readonly markDirty = (): void => {
    this.dirty = true;
  };

  constructor(chart: Chart, container: HTMLElement, canvas: HTMLCanvasElement) {
    this.chart = chart;
    this.container = container;
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Contexte 2D du canvas volume-profile indisponible");
    this.ctx = ctx;
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.running) return;
    if (enabled) this.start();
    else this.stop();
  }

  /** Backfill / bougie clôturée : rien à mémoriser (recalcul par frame), no-op utile pour la symétrie d'API. */
  onCandles(): void {
    /* recalcul fait dans render() — l'abonnement marketStore (start()) marque déjà dirty */
  }

  dispose(): void {
    this.stop();
  }

  private start(): void {
    this.running = true;
    this.dirty = true;
    this.canvas.style.display = "block";
    this.subscribeActions();
    // Tick/clôture de bougie : aucun hook onTick câblé depuis Chart.tsx, donc on
    // s'abonne directement au store (pattern établi du repo) pour marquer dirty.
    this.unsubMarket = marketStore.subscribe(this.markDirty);
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

    const candles = marketStore.getState().candles;
    const range = this.chart.getVisibleRange();
    const from = Math.max(0, range.from);
    const to = Math.min(candles.length, range.to);
    if (to - from < 2) return;

    const vp = computeVolumeProfile(candles, from, to, BIN_COUNT);
    if (vp === null) return;

    // Échelle prix->y linéaire : 2 conversions par frame (cf. orderflow).
    const yMin = this.toPx({ value: vp.priceMin }).y;
    const yMax = this.toPx({ value: vp.priceMax }).y;
    if (yMin === undefined || yMax === undefined) return;
    const yOf = (price: number): number =>
      yMin + ((price - vp.priceMin) / (vp.priceMax - vp.priceMin)) * (yMax - yMin);

    const up = readToken("--up") || "#10b981";
    const down = readToken("--down") || "#ef4444";
    const accent = readToken("--accent") || "#f5c518";

    const maxBarW = width * MAX_WIDTH_FRAC;
    const xRight = left + width; // histogramme ancré au bord droit du pane

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();

    // Bandeau Value Area (léger voile sur la zone 70 %).
    const yVAtop = yOf(vp.vaHigh);
    const yVAbot = yOf(vp.vaLow);
    ctx.fillStyle = "rgba(148,163,184,0.06)";
    ctx.fillRect(left, Math.min(yVAtop, yVAbot), width, Math.abs(yVAbot - yVAtop));

    // Barres horizontales : buy (teinte up) + sell (teinte down) empilées, ancrées à droite.
    for (let b = 0; b < vp.bins.length; b++) {
      const bin = vp.bins[b];
      if (bin === undefined || bin.volume <= 0) continue;
      const yTop = yOf(bin.priceHigh);
      const yBot = yOf(bin.priceLow);
      const h = Math.max(1, Math.abs(yBot - yTop) - 0.5);
      const total = (bin.volume / vp.maxVol) * maxBarW;
      const buyFrac = bin.volume > 0 ? bin.buyVol / bin.volume : 0;
      const buyW = total * buyFrac;
      const sellW = total - buyW;
      const yT = Math.min(yTop, yBot);
      // sell (rouge) collé au bord droit, buy (vert) à sa gauche.
      ctx.fillStyle = down;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(xRight - sellW, yT, sellW, h);
      ctx.fillStyle = up;
      ctx.fillRect(xRight - sellW - buyW, yT, buyW, h);
      ctx.globalAlpha = 1;
      // POC : liseré accent sur toute la largeur du bin.
      if (b === vp.pocIndex) {
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.9;
        ctx.fillRect(xRight - total, yT + h / 2 - 0.5, total, 1.5);
        ctx.globalAlpha = 1;
      }
    }

    ctx.restore();

    // Légende discrète.
    ctx.fillStyle = readToken("--text-dim") || "#9ca3af";
    ctx.font = "10px ui-monospace, SFMono-Regular, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText("Profil Vol (plage visible) · POC", xRight - 4, top + 4);
  }
}
