/**
 * Orderflow (M5) — CVD + footprint, alimenté par le flux de trades de la
 * source active (Binance @aggTrade, Kraken/Coinbase via leur adaptateur).
 *
 * Deux rendus, une seule source tick :
 *  - CVD : sous-pane KLineChart dédié. Cumulative Volume Delta = somme cumulée de
 *    (volTakerBuy − volTakerSell) AGRÉGÉ PAR BOUGIE. On l'obtient depuis
 *    `candle.buyVolume`/`candle.sellVolume` (champ Binance « taker buy base volume »
 *    = exactement l'agrégat des aggTrades côté serveur) : complet et historique,
 *    là où le flux WS ne verrait que les trades postérieurs à la souscription.
 *  - FOOTPRINT : overlay Canvas 2D superposé au pane prix. SEUL le détail
 *    prix-par-prix exige le flux tick @aggTrade ; on bucketise au tickSize.
 *
 * Contrat (BUILD-CONTRACT / M4 spike) :
 *  - Synchro viewport via convertToPixel + subscribeAction (OnScroll/OnZoom/
 *    OnVisibleRangeChange) + boucle rAF — alignement prouvé à 0,5 px.
 *  - AUCUN re-render React sur tick : accumulation O(1) par trade, dessin sur rAF.
 *  - Buffer borné en mémoire (Map<candleTime> évincée au-delà de N) — aucun disque/DB.
 */
import {
  registerIndicator,
  IndicatorSeries,
  ActionType,
  DomPosition,
} from "klinecharts";
import type { Chart, KLineData, Point } from "klinecharts";
import type { Candle, FootprintBar, FootprintRow, Trade, Unsubscribe } from "@axiom/types";
import { fetchSymbolInfo } from "../data/binance";
import { getAdapter } from "../data/adapters";
import { adaptateurReplayActif } from "../data/replayFeed";
import type { MarketStore } from "../store/market";

/** Pane prix (id par défaut de KLineChart, vérifié dans le bundle v9.8.x). */
const CANDLE_PANE_ID = "candle_pane";
/** Id du sous-pane CVD (déterministe). */
const CVD_PANE_ID = "axiom_orderflow_cvd";
/** Nom KLineChart de l'indicateur CVD. */
const CVD_NAME = "AXIOM_CVD";
/** Nombre maximum de bougies conservées dans le buffer footprint (borne mémoire). */
const MAX_FOOTPRINT_CANDLES = 120;
/** Nombre max de colonnes footprint dessinées (perf / lisibilité). */
const MAX_RENDER_COLUMNS = 60;
/** Cible de lignes de prix par bougie (sert à dimensionner le bucket). */
const TARGET_ROWS_PER_CANDLE = 24;

/** Coordonnée renvoyée par convertToPixel (x/y optionnels selon l'entrée). */
interface PixelXY {
  x?: number;
  y?: number;
}

/** Type d'échelle de l'axe prix (miroir de YAxisType klinecharts, câblé par Chart.tsx). */
type PriceAxisType = "normal" | "log" | "percentage";

/** Palette du footprint lue depuis les tokens de thème (le canvas n'évalue pas var()). */
interface FootprintPalette {
  up: string;
  down: string;
  accent: string; // liseré du POC
  text: string; // chiffres buy/sell
  textDim: string; // bornes de la zone de valeur
}

/** Lit un token CSS sémantique concret depuis <html> (le canvas n'évalue pas var()). */
function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Accumulateur buy/sell d'un niveau de prix. */
interface FpCell {
  buy: number;
  sell: number;
}

// ----------------------------------------------------------------------------
// Helpers PURS (testables, sans dépendance KLineChart)
// ----------------------------------------------------------------------------

/**
 * CVD par index de bougie : somme cumulée de (buyVolume − sellVolume).
 * Aligné index-par-index sur `candles` (donc sur la dataList de KLineChart).
 */
export function computeCvd(candles: Candle[]): number[] {
  const out = new Array<number>(candles.length);
  let acc = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (c !== undefined) {
      const buy = c.buyVolume ?? 0;
      const sell = c.sellVolume ?? c.volume - buy;
      acc += buy - sell;
    }
    out[i] = acc;
  }
  return out;
}

/**
 * Construit un FootprintBar depuis la carte de niveaux d'une bougie :
 * delta, POC (niveau au volume total max) et zone de valeur 70 % (VAH/VAL par
 * expansion gloutonne autour du POC).
 */
export function buildFootprintBar(
  time: number,
  cells: Map<number, FpCell>,
  bucketSize: number
): FootprintBar {
  const rows: FootprintRow[] = [];
  let delta = 0;
  for (const [idx, cell] of cells) {
    rows.push({ price: idx * bucketSize, buyVol: cell.buy, sellVol: cell.sell });
    delta += cell.buy - cell.sell;
  }
  rows.sort((a, b) => a.price - b.price);

  // POC + index du POC dans `rows`.
  let pocIdx = 0;
  let pocVol = -1;
  let total = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r === undefined) continue;
    const t = r.buyVol + r.sellVol;
    total += t;
    if (t > pocVol) {
      pocVol = t;
      pocIdx = i;
    }
  }
  const pocRow = rows[pocIdx];
  const poc = pocRow?.price ?? 0;

  // Zone de valeur 70 % : on étend depuis le POC vers le voisin le plus volumineux.
  const target = total * 0.7;
  let lo = pocIdx;
  let hi = pocIdx;
  let acc = pocVol > 0 ? pocVol : 0;
  while (acc < target && (lo > 0 || hi < rows.length - 1)) {
    const up = hi + 1 <= rows.length - 1 ? rows[hi + 1] : undefined;
    const dn = lo - 1 >= 0 ? rows[lo - 1] : undefined;
    const upVol = up ? up.buyVol + up.sellVol : -1;
    const dnVol = dn ? dn.buyVol + dn.sellVol : -1;
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
  const val = rows[lo]?.price ?? poc;
  const vah = rows[hi]?.price ?? poc;

  return { time, rows, poc, vah, val, delta };
}

/** Repli tickSize selon la magnitude du prix (si /exchangeInfo échoue). */
function fallbackTick(price: number): number {
  if (price >= 1000) return 0.1;
  if (price >= 100) return 0.01;
  if (price >= 1) return 0.001;
  return 0.00001;
}

/** Format compact d'un volume (base) pour le texte du footprint. */
function fmtVol(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  if (v >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

/** Format signé d'un delta. */
function fmtDelta(v: number): string {
  return `${v >= 0 ? "+" : "−"}${fmtVol(Math.abs(v))}`;
}

// ----------------------------------------------------------------------------
// Enregistrement (idempotent, module-scope) de l'indicateur CVD
// ----------------------------------------------------------------------------

/** Point CVD côté KLineChart (clé -> valeur finie). */
type CvdPoint = Record<string, number>;

let cvdRegistered = false;

function ensureCvdRegistered(): void {
  if (cvdRegistered) return;
  registerIndicator<CvdPoint>({
    name: CVD_NAME,
    shortName: "CVD",
    series: IndicatorSeries.Normal,
    figures: [{ key: "cvd", title: "CVD: ", type: "line" }],
    // calc PUR de mapping : lit la série pré-calculée (extendData.cvd), alignée
    // index-par-index sur dataList. Aucune math refaite ici, aucun re-render.
    calc: (dataList, indicator) => {
      const ext = indicator.extendData as { cvd?: number[] } | undefined;
      const arr = ext?.cvd;
      return dataList.map((_d, i) => {
        const v = arr?.[i];
        const point: CvdPoint = {};
        if (typeof v === "number" && Number.isFinite(v)) point["cvd"] = v;
        return point;
      });
    },
  });
  cvdRegistered = true;
}

// ----------------------------------------------------------------------------
// Contrôleur orderflow (lié à UNE instance Chart + un canvas overlay)
// ----------------------------------------------------------------------------

export class OrderflowController {
  private readonly chart: Chart;
  private readonly container: HTMLElement; // référentiel de taille/DPR (= conteneur du pane)
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly symbol: string;
  /** Store marché du SLOT hôte (multi-chart) : le CVD/footprint lit CE buffer, pas le global. */
  private readonly store: MarketStore;

  private running = false;
  private raf = 0;
  private unsubTrades: Unsubscribe | null = null;
  private cvdPaneId: string | null = null;
  /** Redessine le footprint seulement si dirty : évite un recalcul complet à 60 fps au repos. */
  private dirty = true;
  private resizeObserver: ResizeObserver | null = null;

  private readonly markDirty = (): void => {
    this.dirty = true;
  };

  private tickSize = 0.01;
  private bucketSize = 0.01;
  private tickResolved = false;

  /**
   * Type d'échelle de l'axe prix. En mode NON linéaire (log/percentage), l'extrapolation
   * linéaire prix→y (2 appels convertToPixel/frame) est fausse : on convertit alors chaque
   * niveau via convertToPixel. Câblé par Chart.tsx (source = le sélecteur de la Toolbar).
   */
  private axisType: PriceAxisType = "normal";

  /** Buffer borné : open time de bougie -> niveaux de prix (footprint). */
  private readonly footprints = new Map<number, Map<number, FpCell>>();

  constructor(
    chart: Chart,
    container: HTMLElement,
    canvas: HTMLCanvasElement,
    symbol: string,
    store: MarketStore
  ) {
    this.chart = chart;
    this.container = container;
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Contexte 2D du canvas footprint indisponible");
    this.ctx = ctx;
    this.symbol = symbol;
    this.store = store;
  }

  // --- Cycle de vie -------------------------------------------------------

  setEnabled(enabled: boolean): void {
    if (enabled === this.running) return;
    if (enabled) this.start();
    else this.stop();
  }

  private start(): void {
    this.running = true;
    this.dirty = true;
    this.canvas.style.display = "block";
    ensureCvdRegistered();
    this.createCvdPane();
    this.subscribeActions();
    // Redimensionnement du conteneur (resize fenêtre, toggle sidebar…) : aucun
    // scroll/zoom/trade ne le signale autrement, d'où l'observer dédié.
    this.resizeObserver = new ResizeObserver(this.markDirty);
    this.resizeObserver.observe(this.container);
    // Si le backfill est déjà présent, on lance les trades tout de suite ;
    // sinon onCandles() (appelé après backfill) déclenchera ensureTrades().
    if (this.store.getState().candles.length > 0) this.ensureTrades();
    this.loop();
  }

  private stop(): void {
    this.running = false;
    this.canvas.style.display = "none";
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.unsubscribeActions();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.unsubTrades) {
      this.unsubTrades();
      this.unsubTrades = null;
    }
    this.removeCvdPane();
    this.footprints.clear();
    this.clearCanvas();
  }

  /** Démontage complet (appelé avant dispose(chart)). */
  dispose(): void {
    this.stop();
  }

  // --- Hooks appelés par Chart.tsx ---------------------------------------

  /** Backfill terminé (ou changement de buffer) : reseed CVD + lance les trades. */
  onCandles(): void {
    this.recomputeBucket(); // peut changer le dimensionnement des lignes du footprint
    this.markDirty();
    if (this.running) {
      this.refreshCvd();
      this.ensureTrades();
    }
  }

  /** Tick kline : rafraîchit le CVD (fréquence kline basse, ~1/s). */
  onTick(): void {
    if (this.running) this.refreshCvd();
  }

  /** Change le type d'échelle de l'axe prix (redessine le footprint à la bonne échelle). */
  setAxisType(type: PriceAxisType): void {
    if (type === this.axisType) return;
    this.axisType = type;
    this.markDirty();
  }

  // --- CVD (sous-pane) ----------------------------------------------------

  private createCvdPane(): void {
    if (this.cvdPaneId) return;
    const cvd = computeCvd(this.store.getState().candles);
    const id = this.chart.createIndicator(
      { name: CVD_NAME, extendData: { cvd } },
      true,
      { id: CVD_PANE_ID }
    );
    this.cvdPaneId = id ?? null;
  }

  private removeCvdPane(): void {
    if (!this.cvdPaneId) return;
    this.chart.removeIndicator(this.cvdPaneId, CVD_NAME);
    this.cvdPaneId = null;
  }

  private refreshCvd(): void {
    if (!this.cvdPaneId) return;
    const cvd = computeCvd(this.store.getState().candles);
    this.chart.overrideIndicator(
      { name: CVD_NAME, extendData: { cvd } },
      this.cvdPaneId
    );
  }

  // --- Footprint : flux de trades + accumulation -------------------------

  /** Souscrit au flux @aggTrade une fois le tickSize/bucket résolus. */
  private ensureTrades(): void {
    if (this.unsubTrades) return; // déjà abonné
    void this.resolveTick().then(() => {
      if (!this.running || this.unsubTrades) return;
      // Flux de trades de la source active (Binance/Kraken/Coinbase) : chaque
      // adaptateur fournit le côté agresseur normalisé (Coinbase est inversé en
      // amont). Le footprint fonctionne donc sur les trois sources. En REPLAY, on lit
      // le moteur de rejeu (trades historiques) → footprint/CVD rejoués sans modification.
      const adapter = adaptateurReplayActif() ?? getAdapter(this.store.getState().exchange);
      this.unsubTrades = adapter.subscribeTrades(this.symbol, (t) =>
        this.onTrade(t)
      );
    });
  }

  /** Résout le tickSize (REST) puis dimensionne le bucket (repli si échec). */
  private async resolveTick(): Promise<void> {
    if (this.tickResolved) return;
    try {
      const meta = await fetchSymbolInfo(this.symbol);
      this.tickSize = meta.tickSize;
    } catch (err) {
      const last = this.store.getState().candles.at(-1);
      this.tickSize = fallbackTick(last?.close ?? 0);
      console.warn("[AXIOM] tickSize indisponible, repli sur la magnitude", err);
    }
    this.tickResolved = true;
    this.recomputeBucket();
  }

  /**
   * Dimensionne le bucket footprint : multiple entier du tickSize choisi pour
   * viser ~TARGET_ROWS_PER_CANDLE lignes sur une bougie typique. La grille reste
   * donc alignée au tickSize (cf. spec) tout en restant lisible/bornée en mémoire.
   */
  private recomputeBucket(): void {
    const candles = this.store.getState().candles;
    const ranges: number[] = [];
    for (const c of candles) {
      const r = c.high - c.low;
      if (r > 0) ranges.push(r);
    }
    if (ranges.length === 0) {
      this.bucketSize = this.tickSize;
      return;
    }
    ranges.sort((a, b) => a - b);
    const median = ranges[Math.floor(ranges.length / 2)] ?? this.tickSize;
    const raw = median / TARGET_ROWS_PER_CANDLE;
    const ticks = Math.max(1, Math.round(raw / this.tickSize));
    this.bucketSize = ticks * this.tickSize;
  }

  /** Accumulation O(1) d'un trade dans la bougie/niveau correspondants. */
  private onTrade(t: Trade): void {
    const candles = this.store.getState().candles;
    const last = candles[candles.length - 1];
    if (last === undefined) return; // pas encore de bougie : on ignore (avant backfill)

    // Bougie cible = dernière bougie dont l'open time <= temps du trade.
    let candleTime = last.time;
    if (t.time < last.time) {
      for (let i = candles.length - 1; i >= 0; i--) {
        const c = candles[i];
        if (c !== undefined && c.time <= t.time) {
          candleTime = c.time;
          break;
        }
      }
    }

    let cells = this.footprints.get(candleTime);
    if (cells === undefined) {
      cells = new Map<number, FpCell>();
      this.footprints.set(candleTime, cells);
      // Borne mémoire : évince la plus ancienne bougie (Map = ordre d'insertion).
      if (this.footprints.size > MAX_FOOTPRINT_CANDLES) {
        const oldest = this.footprints.keys().next().value;
        if (oldest !== undefined) this.footprints.delete(oldest);
      }
    }

    const idx = Math.floor(t.price / this.bucketSize);
    let cell = cells.get(idx);
    if (cell === undefined) {
      cell = { buy: 0, sell: 0 };
      cells.set(idx, cell);
    }
    if (t.side === "buy") cell.buy += t.qty;
    else cell.sell += t.qty;
    this.markDirty();
  }

  // --- Synchro viewport (technique du spike M4) --------------------------

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

  // --- Rendu Canvas 2D du footprint --------------------------------------

  private render(): void {
    if (!this.running) return;
    this.dirty = false; // consommé : la prochaine frame ne refera rien tant que rien ne change.
    const ctx = this.ctx;

    // Backing-store en pixels physiques (DPR) ; dessin en px CSS (setTransform).
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

    // Bornes de l'aire prix (exclut l'axe Y et, le cas échéant, le sous-pane CVD).
    const main = this.chart.getSize(CANDLE_PANE_ID, DomPosition.Main);
    if (!main) return;
    const { left, top, width, height } = main;

    // Échelle prix->y. En mode LINÉAIRE ('normal') : une seule paire convertToPixel par
    // frame puis extrapolation (rapide). En mode NON LINÉAIRE (log/percentage) : cette
    // extrapolation est fausse -> on convertit CHAQUE niveau via convertToPixel (exact).
    const ref = this.store.getState().candles.at(-1);
    const refPrice = ref?.close ?? 0;
    let yOf: (price: number) => number;
    if (this.axisType === "normal") {
      const yBase = this.toPx({ value: refPrice }).y;
      const yStep = this.toPx({ value: refPrice + this.bucketSize }).y;
      if (yBase === undefined || yStep === undefined) return;
      const pxPerBucket = yStep - yBase; // < 0 (prix plus haut => y plus petit)
      yOf = (price: number): number =>
        yBase + ((price - refPrice) / this.bucketSize) * pxPerBucket;
    } else {
      yOf = (price: number): number => this.toPx({ value: price }).y ?? Number.NaN;
    }

    const colW = Math.max(1, this.chart.getBarSpace());
    // Hauteur d'une ligne à hauteur du prix de référence (sert au seuil d'affichage du texte).
    const rowH = Math.abs(yOf(refPrice + this.bucketSize) - yOf(refPrice));

    // Palette du footprint lue une fois par frame depuis les tokens de thème.
    const palette: FootprintPalette = {
      up: readToken("--up") || "#10b981",
      down: readToken("--down") || "#ef4444",
      accent: readToken("--accent") || "#f5c518",
      text: readToken("--text") || "#e5e7eb",
      textDim: readToken("--text-dim") || "#94a3b8",
    };

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();

    // Colonnes à dessiner = bougies visibles ayant des données footprint.
    const range = this.chart.getVisibleRange();
    const dataList = this.chart.getDataList();
    const start = Math.max(range.from, dataList.length - MAX_RENDER_COLUMNS, 0);
    const end = Math.min(range.to, dataList.length);

    ctx.textBaseline = "middle";
    for (let i = start; i < end; i++) {
      const kd: KLineData | undefined = dataList[i];
      if (kd === undefined) continue;
      const cells = this.footprints.get(kd.timestamp);
      if (cells === undefined || cells.size === 0) continue;
      const xc = this.toPx({ timestamp: kd.timestamp }).x;
      if (xc === undefined) continue;
      const bar = buildFootprintBar(kd.timestamp, cells, this.bucketSize);
      this.drawColumn(bar, xc, colW, rowH, yOf, top, height, palette);
    }

    ctx.restore();
  }

  private drawColumn(
    bar: FootprintBar,
    xc: number,
    colW: number,
    rowH: number,
    yOf: (price: number) => number,
    paneTop: number,
    paneHeight: number,
    palette: FootprintPalette
  ): void {
    const ctx = this.ctx;
    const cellW = Math.min(colW * 0.92, 180);
    const xLeft = xc - cellW / 2;
    const paneBottom = paneTop + paneHeight;

    let maxTot = 0;
    for (const r of bar.rows) {
      const t = r.buyVol + r.sellVol;
      if (t > maxTot) maxTot = t;
    }
    if (maxTot <= 0) return;

    const showText = colW >= 44 && rowH >= 9;
    ctx.font = "9px ui-monospace, SFMono-Regular, monospace";

    for (const r of bar.rows) {
      const yTop = yOf(r.price + this.bucketSize);
      const yBot = yOf(r.price);
      if (!Number.isFinite(yTop) || !Number.isFinite(yBot)) continue; // niveau hors échelle
      if (yBot < paneTop || yTop > paneBottom) continue; // hors aire visible
      const h = Math.max(1, yBot - yTop);
      const net = r.buyVol - r.sellVol;
      const intensity = Math.min(1, (r.buyVol + r.sellVol) / maxTot);
      const alpha = 0.12 + 0.5 * intensity;
      // Teinte up/down du thème + intensité via globalAlpha (le canvas n'évalue pas var()).
      ctx.globalAlpha = alpha;
      ctx.fillStyle = net >= 0 ? palette.up : palette.down;
      ctx.fillRect(xLeft, yTop, cellW, h - 1);
      ctx.globalAlpha = 1;

      // POC : contour accent.
      if (r.price === bar.poc) {
        ctx.strokeStyle = palette.accent;
        ctx.lineWidth = 1;
        ctx.strokeRect(xLeft + 0.5, yTop + 0.5, cellW - 1, Math.max(1, h - 1));
      }

      if (showText) {
        const yMid = yTop + h / 2;
        ctx.fillStyle = palette.text;
        ctx.textAlign = "right";
        ctx.fillText(fmtVol(r.sellVol), xc - 3, yMid);
        ctx.textAlign = "left";
        ctx.fillText(fmtVol(r.buyVol), xc + 3, yMid);
      }
    }

    // Bornes de la zone de valeur 70 % : court trait atténué à gauche de la colonne.
    const yVAH = yOf(bar.vah + this.bucketSize);
    const yVAL = yOf(bar.val);
    if (Number.isFinite(yVAH) && Number.isFinite(yVAL)) {
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = palette.textDim;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xLeft - 1.5, yVAH);
      ctx.lineTo(xLeft - 1.5, yVAL);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Delta de la bougie, en haut de la colonne (masqué si trop étroit -> chevauchement).
    if (colW >= 22) {
      ctx.font = "10px ui-monospace, SFMono-Regular, monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = bar.delta >= 0 ? palette.up : palette.down;
      ctx.fillText(fmtDelta(bar.delta), xc, paneTop + 8);
    }
  }
}
