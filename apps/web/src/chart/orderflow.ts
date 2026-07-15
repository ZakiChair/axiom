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
import type { Candle, FootprintBar, IExchangeAdapter, Trade, Unsubscribe } from "@axiom/types";
import { fetchSymbolInfo } from "../data/binance";
import { getAdapter } from "../data/adapters";
import type { MarketStore } from "../store/market";
import { orderflowStore } from "../store/orderflow";
import { cvdDivergenceStore } from "../store/cvd-divergence";
import { detectImbalances, detectDeltaDivergences, type DivergenceFlag } from "./footprintAnalytics";
import { subscribePerpAggTrades } from "../data/binanceFutures";
import { detectCvdDivergences, type CvdDivergence } from "./cvdSpotPerp";
// Calcul pur (CVD, footprint, formatteurs) — cf. ./orderflow.calc.
import {
  buildCvdSpotPerpBuckets,
  buildFootprintBar,
  computeCvd,
  fallbackTick,
  fmtDelta,
  fmtVol,
  type FpCell,
} from "./orderflow.calc";

/** Pane prix (id par défaut de KLineChart, vérifié dans le bundle v9.8.x). */
const CANDLE_PANE_ID = "candle_pane";
/** Id du sous-pane CVD (déterministe). */
const CVD_PANE_ID = "axiom_orderflow_cvd";
/** Nom KLineChart de l'indicateur CVD. */
const CVD_NAME = "AXIOM_CVD";
/** Id du sous-pane CVD spot vs perp (Task 17). */
const CVD_SP_PANE_ID = "axiom_orderflow_cvd_sp";
/** Nom KLineChart de l'indicateur CVD spot vs perp. */
const CVD_SP_NAME = "AXIOM_CVD_SP";
/** Lookback (bougies) du détecteur de divergences CVD spot/perp (cf. brief Task 16). */
const CVD_SP_LOOKBACK = 14;
/** Borne mémoire du buffer de deltas perp par bougie (miroir du footprint). */
const MAX_PERP_CANDLES = 500;
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

// Cœur de calcul PUR extrait dans ./orderflow.calc (CVD, footprint, formatteurs).
// Re-exporté ici pour les consommateurs historiques (ex. orderflow.cvd.test.ts).
export { computeCvd, buildCvdSpotPerpBuckets, buildFootprintBar } from "./orderflow.calc";

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
// Enregistrement (idempotent) de l'indicateur CVD spot vs perp (Task 17)
// ----------------------------------------------------------------------------

/** Point CVD S/P côté KLineChart : deux courbes (spot, perp) par bougie. */
interface CvdSpPoint {
  spot?: number;
  perp?: number;
}

/** Données injectées dans l'indicateur (indexées par timestamp de bougie). */
interface CvdSpExtend {
  spotByTime: Record<number, number>;
  perpByTime: Record<number, number>;
  divByTime: Record<number, CvdDivergence["kind"]>;
}

let cvdSpRegistered = false;

function ensureCvdSpRegistered(): void {
  if (cvdSpRegistered) return;
  registerIndicator<CvdSpPoint>({
    name: CVD_SP_NAME,
    shortName: "CVD S/P",
    series: IndicatorSeries.Normal,
    // spot = token --up (vert), perp = token --accent (jaune). Lus au rendu → thème-aware.
    figures: [
      { key: "spot", title: "Spot: ", type: "line", styles: () => ({ color: readToken("--up") || "#10b981" }) },
      { key: "perp", title: "Perp: ", type: "line", styles: () => ({ color: readToken("--accent") || "#f5c518" }) },
    ],
    // calc PUR de mapping : lit les séries pré-calculées (extendData) par timestamp.
    calc: (dataList, indicator) => {
      const ext = indicator.extendData as CvdSpExtend | undefined;
      return dataList.map((kd) => {
        const point: CvdSpPoint = {};
        const s = ext?.spotByTime?.[kd.timestamp];
        const p = ext?.perpByTime?.[kd.timestamp];
        if (typeof s === "number" && Number.isFinite(s)) point.spot = s;
        if (typeof p === "number" && Number.isFinite(p)) point.perp = p;
        return point;
      });
    },
    // Triangles de divergence au sommet du pane (même style que les divergences
    // delta du footprint : 6 px, --up bas / --down haut). Rendu AVANT les courbes
    // (retourne false → KLineChart dessine ensuite les lignes par-dessus).
    draw: ({ ctx, kLineDataList, visibleRange, bounding, xAxis, indicator }) => {
      const ext = indicator.extendData as CvdSpExtend | undefined;
      const divByTime = ext?.divByTime;
      if (!divByTime) return false;
      const up = readToken("--up") || "#10b981";
      const down = readToken("--down") || "#ef4444";
      const size = 6;
      const yTop = bounding.top + 2;
      for (let i = visibleRange.from; i < visibleRange.to; i++) {
        const kd = kLineDataList[i];
        if (kd === undefined) continue;
        const kind = divByTime[kd.timestamp];
        if (kind === undefined) continue;
        const x = xAxis.convertToPixel(i);
        if (!Number.isFinite(x)) continue;
        ctx.beginPath();
        if (kind === "spotUp_perpDown") {
          // Spot achète, perp vend : triangle vers le bas (biais achat spot).
          ctx.moveTo(x, yTop + size);
          ctx.lineTo(x - size, yTop);
          ctx.lineTo(x + size, yTop);
          ctx.fillStyle = up;
        } else {
          // Spot vend, perp achète : triangle vers le haut.
          ctx.moveTo(x, yTop);
          ctx.lineTo(x - size, yTop + size);
          ctx.lineTo(x + size, yTop + size);
          ctx.fillStyle = down;
        }
        ctx.closePath();
        ctx.fill();
      }
      return false;
    },
  });
  cvdSpRegistered = true;
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

  // --- CVD spot vs perp (Task 17) : sous-feature auto-gérée du contrôleur ---
  /** Id du sous-pane CVD S/P (null tant qu'inactif). */
  private spCvdPaneId: string | null = null;
  /** Désabonnement du flux WS perp (fstream) — null tant qu'inactif. */
  private unsubPerp: Unsubscribe | null = null;
  /** Abonnement au store orderflow pour réagir au toggle `cvdSpotPerp`. */
  private unsubOrderflowStore: (() => void) | null = null;
  /** Le sous-pane CVD S/P est-il actif (toggle + binance + hors replay) ? */
  private spRunning = false;
  /** Delta perp PAR bougie (open time -> somme buy−sell), depuis la souscription. */
  private readonly perpDelta = new Map<number, number>();

  constructor(
    chart: Chart,
    container: HTMLElement,
    canvas: HTMLCanvasElement,
    symbol: string,
    store: MarketStore,
    /** Adaptateur propre à CE slot (replay), jamais l'adaptateur global d'un autre slot. */
    private readonly replayAdapter: IExchangeAdapter | null = null,
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
    // CVD spot vs perp (Task 17) : sous-feature pilotée par son propre toggle. Le
    // contrôleur s'abonne lui-même (comme DerivativesChartController) → aucun câblage
    // supplémentaire dans ChartInstance. Init immédiate si le toggle est déjà actif.
    this.unsubOrderflowStore = orderflowStore.subscribe(() => this.syncCvdSpotPerp());
    this.syncCvdSpotPerp();
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
    // CVD spot vs perp : désabonne le store PUIS démonte le sous-pane + le flux WS perp.
    if (this.unsubOrderflowStore) {
      this.unsubOrderflowStore();
      this.unsubOrderflowStore = null;
    }
    this.teardownCvdSpotPerp();
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
      if (this.spRunning) this.refreshCvdSpotPerp();
    }
  }

  /** Tick kline : rafraîchit le CVD (fréquence kline basse, ~1/s). */
  onTick(): void {
    if (this.running) {
      this.refreshCvd();
      if (this.spRunning) this.refreshCvdSpotPerp();
    }
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

  // --- CVD spot vs perp (sous-pane « CVD S/P » + triangles de divergence) --

  /** Souhaité ssi : toggle activé ET source binance (flux perp Binance-only) ET hors replay
   *  (pas de flux perp historique — on n'affiche pas de live perp sur des bougies rejouées). */
  private wantCvdSpotPerp(): boolean {
    return (
      orderflowStore.getState().cvdSpotPerp &&
      this.store.getState().exchange === "binance" &&
      this.replayAdapter === null
    );
  }

  /** Réconcilie l'état du sous-pane avec le toggle (appelé au start + à chaque changement de store). */
  private syncCvdSpotPerp(): void {
    if (!this.running) return;
    const want = this.wantCvdSpotPerp();
    if (want && !this.spRunning) this.startCvdSpotPerp();
    else if (!want && this.spRunning) this.teardownCvdSpotPerp();
  }

  private startCvdSpotPerp(): void {
    this.spRunning = true;
    ensureCvdSpRegistered();
    // Flux WS aggTrade du perpétuel (fstream, Binance-only) → accumulation par bougie.
    this.unsubPerp = subscribePerpAggTrades(this.symbol, (t) => this.onPerpTrade(t));
    this.refreshCvdSpotPerp();
  }

  /** Démonte le sous-pane CVD S/P : ferme le flux WS perp, retire le pane, vide le buffer. */
  private teardownCvdSpotPerp(): void {
    this.spRunning = false;
    if (this.unsubPerp) {
      this.unsubPerp();
      this.unsubPerp = null;
    }
    if (this.spCvdPaneId) {
      this.chart.removeIndicator(this.spCvdPaneId, CVD_SP_NAME);
      this.spCvdPaneId = null;
    }
    this.perpDelta.clear();
    // Pipeline off → alertes CVD non évaluables (undefined, pas null).
    cvdDivergenceStore.getState().clear(this.symbol);
  }

  /** Accumulation O(1) d'un trade perp dans la bougie correspondante (delta signé). */
  private onPerpTrade(t: Trade): void {
    const candles = this.store.getState().candles;
    const last = candles[candles.length - 1];
    if (last === undefined) return; // pas encore de bougie : on ignore (avant backfill)

    // Bougie cible = dernière bougie dont l'open time <= temps du trade (miroir onTrade).
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

    const signed = t.side === "buy" ? t.qty : -t.qty;
    const prev = this.perpDelta.get(candleTime);
    if (prev === undefined) {
      this.perpDelta.set(candleTime, signed);
      // Borne mémoire : évince la plus ancienne bougie (Map = ordre d'insertion).
      if (this.perpDelta.size > MAX_PERP_CANDLES) {
        const oldest = this.perpDelta.keys().next().value;
        if (oldest !== undefined) this.perpDelta.delete(oldest);
      }
    } else {
      this.perpDelta.set(candleTime, prev + signed);
    }
  }

  /** Reconstruit les buckets (re-basés), détecte les divergences, pousse dans l'indicateur. */
  private refreshCvdSpotPerp(): void {
    if (!this.spRunning) return;
    const candles = this.store.getState().candles;
    const buckets = buildCvdSpotPerpBuckets(candles, this.perpDelta);
    const spotByTime: Record<number, number> = {};
    const perpByTime: Record<number, number> = {};
    for (const b of buckets) {
      spotByTime[b.time] = b.spot;
      perpByTime[b.time] = b.perp;
    }
    const divergences = detectCvdDivergences(buckets, CVD_SP_LOOKBACK);
    const divByTime: Record<number, CvdDivergence["kind"]> = {};
    for (const d of divergences) {
      divByTime[d.time] = d.kind;
    }
    // Pont alertes : dernière divergence détectée (ou null = pipeline prêt, pas de div).
    const derniere = divergences[divergences.length - 1];
    cvdDivergenceStore.getState().setKind(this.symbol, derniere?.kind ?? null);
    const extendData: CvdSpExtend = { spotByTime, perpByTime, divByTime };
    if (this.spCvdPaneId) {
      this.chart.overrideIndicator({ name: CVD_SP_NAME, extendData }, this.spCvdPaneId);
    } else {
      this.spCvdPaneId =
        this.chart.createIndicator({ name: CVD_SP_NAME, extendData }, true, {
          id: CVD_SP_PANE_ID,
        }) ?? null;
    }
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
      const adapter = this.replayAdapter ?? getAdapter(this.store.getState().exchange);
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

    // Colonnes à dessiner = bougies visibles ayant des données footprint.
    const range = this.chart.getVisibleRange();
    const dataList = this.chart.getDataList();
    const candles = this.store.getState().candles;
    const start = Math.max(range.from, dataList.length - MAX_RENDER_COLUMNS, 0);
    const end = Math.min(range.to, dataList.length);

    // Palette du footprint lue une fois par frame depuis les tokens de thème.
    const palette: FootprintPalette = {
      up: readToken("--up") || "#10b981",
      down: readToken("--down") || "#ef4444",
      accent: readToken("--accent") || "#f5c518",
      text: readToken("--text") || "#e5e7eb",
      textDim: readToken("--text-dim") || "#94a3b8",
    };

    // Palette des imbalances (lue depuis les tokens dédiés, ou repli sur palette).
    const imbPalette = {
      ask: readToken("--of-imb-buy") || palette.up,
      bid: readToken("--of-imb-sell") || palette.down,
    };

    // Collecte des données analytiques : candles + bars visibles, imbalances par bar, divergences.
    const settings = orderflowStore.getState();
    const visibleCandles: Candle[] = [];
    const visibleBars: FootprintBar[] = [];
    const barPositions: { xc: number; colW: number }[] = [];

    for (let i = start; i < end; i++) {
      const kd: KLineData | undefined = dataList[i];
      if (kd === undefined) continue;
      const cells = this.footprints.get(kd.timestamp);
      if (cells === undefined || cells.size === 0) continue;
      const xc = this.toPx({ timestamp: kd.timestamp }).x;
      if (xc === undefined) continue;
      const candle = candles[i];
      if (candle === undefined) continue;
      visibleCandles.push(candle);
      const bar = buildFootprintBar(kd.timestamp, cells, this.bucketSize);
      visibleBars.push(bar);
      barPositions.push({ xc, colW });
    }

    // Divergences delta : calculées une fois sur toutes les bars visibles.
    const divergences =
      settings.showDivergences && visibleBars.length > 1
        ? detectDeltaDivergences(visibleCandles, visibleBars)
        : new Array(visibleBars.length).fill(null);

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();

    ctx.textBaseline = "middle";
    for (let i = 0; i < visibleBars.length; i++) {
      const bar = visibleBars[i];
      const pos = barPositions[i];
      if (bar === undefined || pos === undefined) continue;

      // Imbalances : calculées par bar au rendu seulement.
      const imbFlags =
        settings.showImbalances
          ? detectImbalances(bar.rows, settings.imbalanceRatioPct, settings.imbalanceMinVol)
          : null;

      this.drawColumn(
        bar,
        pos.xc,
        pos.colW,
        rowH,
        yOf,
        top,
        height,
        palette,
        imbPalette,
        imbFlags,
        settings.showBarPoc,
        settings.showBarVa,
        divergences[i]
      );
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
    palette: FootprintPalette,
    imbPalette: { ask: string; bid: string },
    imbFlags: ReturnType<typeof detectImbalances> | null,
    showBarPoc: boolean,
    showBarVa: boolean,
    divergence: DivergenceFlag
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

      // POC : contour accent (si activé).
      if (showBarPoc && r.price === bar.poc) {
        ctx.strokeStyle = palette.accent;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(xLeft + 0.5, yTop + 0.5, cellW - 1, Math.max(1, h - 1));
      }

      // Imbalances : liseré coloré sur la cellule concernée.
      if (imbFlags !== null) {
        const idx = bar.rows.indexOf(r);
        if (idx >= 0) {
          if (imbFlags.askImb[idx] || imbFlags.stackedAsk[idx]) {
            ctx.strokeStyle = imbPalette.ask;
            ctx.lineWidth = imbFlags.stackedAsk[idx] ? 2.5 : 1.5;
            ctx.strokeRect(xLeft + 0.5, yTop + 0.5, cellW - 1, Math.max(1, h - 1));
          }
          if (imbFlags.bidImb[idx] || imbFlags.stackedBid[idx]) {
            ctx.strokeStyle = imbPalette.bid;
            ctx.lineWidth = imbFlags.stackedBid[idx] ? 2.5 : 1.5;
            ctx.strokeRect(xLeft + 0.5, yTop + 0.5, cellW - 1, Math.max(1, h - 1));
          }
        }
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

    // Bornes de la zone de valeur 70 % : bande translucide (si activé) OU trait atténué à gauche.
    const yVAH = yOf(bar.vah + this.bucketSize);
    const yVAL = yOf(bar.val);
    if (showBarVa && Number.isFinite(yVAH) && Number.isFinite(yVAL)) {
      // Bandeau VAL → VAH translucide.
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = palette.textDim;
      ctx.fillRect(xLeft, Math.min(yVAH, yVAL), cellW, Math.abs(yVAL - yVAH));
      ctx.globalAlpha = 1;
    } else if (Number.isFinite(yVAH) && Number.isFinite(yVAL)) {
      // Trait atténué à gauche de la colonne (comportement par défaut).
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

    // Divergence delta : triangle 6 px au-dessus de la bougie.
    if (divergence !== null && colW >= 22) {
      const yDivTop = paneTop + 2;
      const size = 6;
      ctx.beginPath();
      if (divergence === "bull") {
        // Triangle pointant vers le bas (achat).
        ctx.moveTo(xc, yDivTop + size);
        ctx.lineTo(xc - size, yDivTop);
        ctx.lineTo(xc + size, yDivTop);
        ctx.closePath();
        ctx.fillStyle = palette.up;
      } else {
        // Triangle pointant vers le haut (vente).
        ctx.moveTo(xc, yDivTop);
        ctx.lineTo(xc - size, yDivTop + size);
        ctx.lineTo(xc + size, yDivTop + size);
        ctx.closePath();
        ctx.fillStyle = palette.down;
      }
      ctx.fill();
    }
  }
}
