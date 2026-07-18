/**
 * ChartInstance — UNE instance KLineChart autonome (Phase 4, multi-chart).
 *
 * Généralise l'ancien `Chart` en composant réutilisable par slot de grille :
 *  - buffer/symbole/TF/source PROPRES (store marché injecté = global pour le slot
 *    MAÎTRE, local pour les secondaires) ;
 *  - rôle « master » : jeu COMPLET de contrôleurs branchés sur les stores GLOBAUX
 *    (indicateurs, compare, volume profile, revenus, macro, dérivés, orderflow…) —
 *    comportement IDENTIQUE au mono-chart d'avant ;
 *  - rôle « secondary » : jeu LÉGER (bougies + indicateurs partagés + dessin + thème),
 *    SANS les sous-panes lourds (compare/vp/revenue/macro/deriv) ;
 *  - ORDERFLOW réservé au slot FOCUS (contrainte perf roadmap 4.1) : le footprint/CVD
 *    ne tourne que sur le slot focus, quel qu'il soit, et lit SON buffer (store injecté) ;
 *  - ticks WS COALESCÉS par rAF (~10 upd/s) sur le chemin store→chart, flush immédiat
 *    à la clôture d'une bougie (finalisation exacte) ;
 *  - crosshair SYNCHRONISÉ par timestamp entre slots (léger, canvas dédié).
 *
 * Flux inchangé (par instance) : backfill REST → applyNewData, puis WS → updateData
 * IMPÉRATIF (aucun re-render React sur tick). API KLineChart v9.8.x confirmée.
 */
import { useEffect, useRef, useState } from "react";
import { dispose, init, ActionType, DomPosition, LoadDataType, YAxisType } from "klinecharts";
import type { Chart as KLineChartInstance, Crosshair, KLineData } from "klinecharts";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { Candle, ExchangeId, Timeframe, Unsubscribe } from "@axiom/types";
import { getAdapter } from "../data/adapters";
import { prepareResyncApply } from "../data/resync";
import { adaptateurReplayActif } from "../data/replayFeed";
import { replayStore } from "../store/replay";
import {
  isMarketDataReady,
  marketIdentity,
  sameMarketIdentity,
  type MarketDataLoadState,
  type MarketIdentity,
  type MarketStore,
} from "../store/market";
import { indicatorsStore } from "../store/indicators";
import { orderflowStore } from "../store/orderflow";
import { compareStore } from "../store/compare";
import { volumeProfileStore } from "../store/volumeProfile";
import { revenueStore } from "../store/revenue";
import { macroOverlayStore } from "../store/macro-overlays";
import { macroHistoryStore } from "../store/macroHistory";
import { themeStore } from "../store/theme";
import { chartLayoutStore } from "../store/chart-layout";
import { ChartIndicators } from "./indicators";
import { PaneHeaders } from "./paneHeaders";
import { OverlayLegend } from "./overlayLegend";
import { OrderflowController } from "./orderflow";
import { CompareController } from "./compare";
import { VolumeProfileController } from "./volumeProfile";
import { LiquidationHeatController } from "./liquidationHeat";
import { liqMarksStore } from "./liquidationMarkers";
import { RevenueController } from "./revenue";
import { MacroController } from "./macro";
import { DerivativesChartController } from "./derivatives";
import { bindChart, unbindChart, setFocusChart, redrawFibOverlays, restoreDrawings, purgeChartDrawings } from "./drawing";
import { fibStore } from "./fibonacci";
import { createRafThrottle, type RafThrottle } from "./rafThrottle";
import { bindPriceAlertMenu } from "./priceAlertMenu";
import { MeasureTool } from "./measureTool";
import { CandleReadout } from "./candleReadout";
import { SymbolBanner } from "../components/SymbolBanner";
import { lireTokenCanvas } from "../lib/canvasTokens";

/** Type d'échelle de l'axe prix (miroir de YAxisType klinecharts). */
export type PriceScaleType = "normal" | "log" | "percentage";

export interface PriceScaleState {
  /** Échelle courante de l'axe prix : linéaire / logarithmique / pourcentage. */
  type: PriceScaleType;
  setType: (type: PriceScaleType) => void;
}

/**
 * Store d'échelle de l'axe prix — Zustand VANILLA (hors render-loop). Réglé par la
 * Toolbar, lu par CHAQUE instance (setStyles + footprint orderflow). Partagé par tous
 * les slots (échelle commune). Co-localisé ici pour éviter un import circulaire.
 */
export const priceScaleStore = createStore<PriceScaleState>((set) => ({
  type: "normal",
  setType: (type) => set({ type }),
}));

/**
 * Crosshair partagé entre slots (Phase 4) — Zustand VANILLA. Le slot survolé publie le
 * timestamp pointé ; les AUTRES slots tracent une ligne verticale à ce timestamp
 * (convertToPixel). `source` = slot émetteur (évite de se re-tracer soi-même).
 */
export interface CrosshairSyncState {
  time: number | null;
  source: number;
}
export const crosshairSyncStore = createStore<CrosshairSyncState>(() => ({
  time: null,
  source: -1,
}));

/** Mappe l'échelle du store vers l'enum YAxisType attendu par `setStyles` de KLineChart. */
const Y_AXIS_TYPE: Record<PriceScaleType, YAxisType> = {
  normal: YAxisType.Normal,
  log: YAxisType.Log,
  percentage: YAxisType.Percentage,
};

/** Pane prix (id par défaut KLineChart, vérifié dans le bundle v9.8.x). */
const CANDLE_PANE_ID = "candle_pane";
/** Nombre de bougies récupérées par page d'historique (scroll gauche). */
const PAGINATION_LIMIT = 500;
/** Plafond du buffer marché au fil des paginations (borne mémoire session longue). */
const PAGINATION_MAX_CANDLES = 20_000;
/** Débit max des ticks WS appliqués au graphe (coalescés par rAF) : ~10 upd/s par chart. */
const TICK_MIN_INTERVAL_MS = 100;

/** Timeframes proposés dans l'en-tête d'un slot secondaire (sous-ensemble commun). */
const SECONDARY_TFS: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "1d"];
/** Sources proposées dans l'en-tête d'un slot secondaire. */
const SECONDARY_SOURCES: { id: ExchangeId; label: string }[] = [
  { id: "binance", label: "Binance" },
  { id: "coinbase", label: "Coinbase" },
  { id: "kraken", label: "Kraken" },
  { id: "mexc", label: "MEXC" },
  { id: "twelvedata", label: "TwelveData" },
  // Affiché seulement quand le slot porte déjà une série construite via la palette SYN.
  { id: "synthetic", label: "Synthétique" },
];

/**
 * Dernier viewport connu (zoom + décalage droit) PAR SLOT, capturé AVANT `dispose()`.
 * Restaure le cadrage best-effort au changement de TF SUR LE MÊME ACTIF (même source ET
 * même symbole — `symbol` fait partie de la clé de garde, pas seulement `exchange` :
 * sinon un vrai changement d'actif hérite du cadrage de l'actif précédent). Clé = slot
 * (chaque instance a son propre historique de cadrage). Module-scope : survit au
 * démontage/remontage de l'effet.
 */
const lastViewport = new Map<
  number,
  { exchange: ExchangeId; symbol: string; barSpace: number; offsetRight: number }
>();

/**
 * Précision d'affichage du prix dérivée de la magnitude (≈5 chiffres significatifs,
 * bornée [2, 8]) — indispensable pour les tokens « sub-cent » (PUMPUSDT 0.0013…).
 */
function derivePricePrecision(candles: Candle[]): number {
  const ref = candles.at(-1)?.close ?? candles[0]?.close ?? 0;
  if (!(ref > 0)) return 2;
  const p = 4 - Math.floor(Math.log10(ref));
  return Math.min(8, Math.max(2, p));
}

/** Candle (@axiom/types) -> KLineData (KLineChart). */
function toKLineData(c: Candle): KLineData {
  return { timestamp: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
}

/**
 * `subscribeKline` enrichi d'un 4e argument `onResync` : rappelé par l'adaptateur après
 * une reconnexion WS avec un lot REST à fusionner. ABSENT d'`IExchangeAdapter` (contrat
 * figé) → typé localement + cast au point d'appel (tous les adaptateurs le supportent).
 */
type SubscribeKlineAvecResync = (
  symbol: string,
  tf: Timeframe,
  cb: (c: Candle) => void,
  onResync?: (candles: Candle[]) => void,
) => Unsubscribe;

/** Applique la palette du thème courant au graphe (bougies/grille/axes/crosshair + fond). */
function applyChartTheme(chart: KLineChartInstance, chartDom: HTMLElement): void {
  const bg = lireTokenCanvas("--bg", "");
  const surface = lireTokenCanvas("--surface", "");
  const border = lireTokenCanvas("--border", "");
  const text = lireTokenCanvas("--text", "");
  const textDim = lireTokenCanvas("--text-dim", "");
  const up = lireTokenCanvas("--up", "");
  const down = lireTokenCanvas("--down", "");
  // Bougies : token dédié (pastel en « cute »), avec repli sur --up/--down si absent.
  const candleUp = lireTokenCanvas("--candle-up", up);
  const candleDown = lireTokenCanvas("--candle-down", down);
  const grid = lireTokenCanvas("--grid", "");
  const crosshair = lireTokenCanvas("--crosshair", "");
  const atmos = lireTokenCanvas("--atmos", "");
  const font = lireTokenCanvas("--font-display", "");

  chartDom.style.backgroundColor = bg;
  chartDom.style.backgroundImage = atmos && atmos !== "none" ? atmos : "";

  chart.setStyles({
    grid: { horizontal: { color: grid }, vertical: { color: grid } },
    // Légende native (nom + valeur) laissée aux défauts KLineChart (showName/showParams) :
    // elle est désormais la SEULE source du NOM d'indicateur — panes séparés ET overlays.
    // Indispensable pour les overlays (EMA/BOLL) : leur en-tête DOM (chart/overlayLegend.ts)
    // n'affiche qu'une croix ✕ de suppression, jamais le nom — deux instances d'un même
    // overlay (EMA(20)+EMA(50)) ne sont donc distinguables QUE par leurs paramètres dans
    // cette légende native. L'en-tête DOM des panes séparés (chart/paneHeaders.tsx) ne porte
    // pas non plus le nom (juste ⠿ + ✕, décalés en haut à DROITE du pane) : plus de double
    // impression du nom (audit #2/#10).
    // NB : la portée est forcément globale — klinecharts@9.8.12 lit showName depuis les styles
    // GLOBAUX (getStyles().indicator.tooltip), un override par indicateur est ignoré.
    candle: {
      bar: {
        upColor: candleUp,
        downColor: candleDown,
        noChangeColor: textDim,
        upBorderColor: candleUp,
        downBorderColor: candleDown,
        noChangeBorderColor: textDim,
        upWickColor: candleUp,
        downWickColor: candleDown,
        noChangeWickColor: textDim,
      },
      priceMark: {
        high: { color: textDim, textFamily: font },
        low: { color: textDim, textFamily: font },
        last: { upColor: candleUp, downColor: candleDown, noChangeColor: textDim, text: { family: font } },
      },
    },
    xAxis: { axisLine: { color: border }, tickLine: { color: border }, tickText: { color: textDim, family: font } },
    yAxis: { axisLine: { color: border }, tickLine: { color: border }, tickText: { color: textDim, family: font } },
    crosshair: {
      horizontal: {
        line: { color: crosshair },
        text: { color: text, family: font, backgroundColor: surface, borderColor: border },
      },
      vertical: {
        line: { color: crosshair },
        text: { color: text, family: font, backgroundColor: surface, borderColor: border },
      },
    },
  });
}

/**
 * Objets à VIE LONGUE d'un slot — créés par l'effet MONTAGE (deps `[slot]`), réutilisés
 * par l'effet DONNÉES à chaque changement exchange/symbole/TF/replay. C'est le socle du
 * fix « flash » : l'instance KLineChart (et son DOM) SURVIT à ces changements ; seule la
 * série est rechargée. Partagés entre les deux effets via `mountRef`.
 */
interface SlotMount {
  chart: KLineChartInstance;
  indicators: ChartIndicators;
  paneHeaders: PaneHeaders;
  overlayLegend: OverlayLegend;
  updateThrottle: RafThrottle;
  // Zoom/décalage de l'instance juste après `init()`, avant toute interaction utilisateur.
  // klinecharts ne réinitialise JAMAIS barSpace/offsetRightDistance sur `applyNewData` (seul
  // le range visible l'est) : au changement d'ACTIF (pas juste de TF), il faut revenir
  // explicitement à ces valeurs plutôt que de laisser le cadrage de l'ancien actif fausser
  // l'échelle Y du nouveau (bougies hors-cadre / axe qui ne s'adapte plus).
  defaultBarSpace: number;
  defaultOffsetRight: number;
}

export interface ChartInstanceProps {
  /** Store marché de CE slot (global pour le maître, local pour les secondaires). */
  store: MarketStore;
  /** Index de grille (0 = maître). */
  slot: number;
  role: "master" | "secondary";
  /** Édition de la config (slots secondaires) — link-aware côté ChartGrid. */
  onChangeSymbol?: (symbol: string) => void;
  onChangeTimeframe?: (tf: Timeframe) => void;
  onChangeExchange?: (ex: ExchangeId) => void;
}

/** Message volontairement stable : le détail technique reste dans la console/Health. */
function dataLoadErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") return "Chargement annulé.";
  if (error instanceof Error && /timeout|timed out|délai/i.test(error.message)) {
    return "La source n’a pas répondu dans le délai prévu.";
  }
  return "La source n’a pas pu fournir l’historique demandé.";
}

export function ChartInstance({
  store,
  slot,
  role,
  onChangeSymbol,
  onChangeTimeframe,
  onChangeExchange,
}: ChartInstanceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null); // footprint (orderflow)
  const vpCanvasRef = useRef<HTMLCanvasElement>(null); // volume profile (maître)
  const liqCanvasRef = useRef<HTMLCanvasElement>(null); // heatmap liquidations (maître)
  const xhairCanvasRef = useRef<HTMLCanvasElement>(null); // crosshair synchronisé inter-slots

  // Objets à vie longue (instance KLineChart + indicateurs + en-têtes + throttle des ticks),
  // partagés par l'effet MONTAGE vers l'effet DONNÉES. `teardownDataRef` expose le démontage
  // de la couche données afin que le cleanup MONTAGE puisse l'invoquer AVANT `dispose(chart)`
  // (voir l'effet MONTAGE pour la raison d'ordre React).
  const mountRef = useRef<SlotMount | null>(null);
  const teardownDataRef = useRef<(() => void) | null>(null);

  const exchange = useStore(store, (s) => s.exchange);
  const symbol = useStore(store, (s) => s.symbol);
  const timeframe = useStore(store, (s) => s.timeframe);
  // Seul ce petit objet basse fréquence déclenche un rendu React ; `candles` reste hors
  // render-loop. Il porte la provenance du dernier succès et l'état de la requête courante.
  const dataLoad = useStore(store, (s) => s.dataLoad);
  const [retryRevision, setRetryRevision] = useState(0);
  const focus = useStore(chartLayoutStore, (s) => s.focus);
  const layout = useStore(chartLayoutStore, (s) => s.layout);
  const orderflowEnabled = useStore(orderflowStore, (s) => s.enabled);
  const isMaster = role === "master";
  const isFocus = focus === slot;
  // Replay (roadmap 4.4) : ce slot est-il en rejeu ? `gen` (primitif) force le remontage
  // de l'effet à chaque start/seek/stop — c'est le mécanisme de suspension/reprise des WS
  // live (dispose au démontage → resubscribe + backfill au remontage). `replayLabel`
  // (chaîne primitive) alimente la bannière SANS re-render à chaque tick du curseur.
  const replayGen = useStore(replayStore, (s) => (s.active && s.slot === slot ? s.gen : 0));
  const replayLabel = useStore(replayStore, (s) =>
    s.active && s.slot === slot ? `${s.symbole} · ${s.jour} · ${s.tf}` : "",
  );

  // ── Effet MONTAGE (deps `[slot]`) : cycle de vie de l'INSTANCE ────────────
  // Crée l'instance KLineChart + les objets à vie longue (indicateurs, en-têtes de panes,
  // throttle des ticks, crosshair synchronisé, thème) UNE fois par slot monté. Ces éléments
  // SURVIVENT aux changements exchange/symbole/TF/replay (gérés par l'effet DONNÉES) : c'est
  // ce qui supprime le « flash » au changement de TF (plus de dispose/init du chart).
  useEffect(() => {
    const container = containerRef.current;
    const chartDom = chartRef.current;
    const xhairCanvas = xhairCanvasRef.current;
    if (!container || !chartDom || !xhairCanvas) return;

    const chart = init(chartDom);
    if (!chart) return;

    // Thème (bougies/grille/axes/crosshair + fond) — appliqué puis réabonné.
    applyChartTheme(chart, chartDom);
    const unsubscribeTheme = themeStore.subscribe(() => applyChartTheme(chart, chartDom));

    // Contrôleur d'indicateurs @axiom (partagé : même sélection sur tous les slots ;
    // chaque slot calcule sur SON buffer). L'abonnement `indicatorsStore` qui CAPTURE
    // `exchange` vit dans l'effet DONNÉES (il doit lire la source courante).
    const indicators = new ChartIndicators(chart);

    // En-têtes overlay des panes séparés (croix + drag-reorder) : le contrôleur lit
    // `indicatorsStore` lui-même (pas besoin de brancher `state`).
    const paneHeaders = new PaneHeaders(chart, container);
    // Légende des indicateurs overlay (EMA/BOLL/VWAP ancré…) sur le pane prix : croix ✕
    // de suppression directe, même cycle de vie que paneHeaders (cf. chart/overlayLegend.ts).
    const overlayLegend = new OverlayLegend(chart, container);
    const unsubscribePaneHeaders = indicatorsStore.subscribe(() => {
      paneHeaders.sync();
      overlayLegend.sync();
    });
    paneHeaders.sync();
    overlayLegend.sync();

    // Outils d'analyse de prix (contrôleurs impératifs, overlays DOM propres à ce slot) :
    //  - measureTool : règle Shift+glisser transitoire (écart %/Δ/bougies/durée).
    //  - candleReadout : encart O/H/L/C + variation % + amplitude qui suit le crosshair.
    const measureTool = new MeasureTool(chart, chartDom, container);
    const candleReadout = new CandleReadout(chart, container);

    // ── Crosshair synchronisé inter-slots ──────────────────────────────────
    const drawSyncedCrosshair = (): void => {
      const ctx = xhairCanvas.getContext("2d");
      if (!ctx) return;
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const cssW = container.clientWidth;
      const cssH = container.clientHeight;
      const bw = Math.round(cssW * dpr);
      const bh = Math.round(cssH * dpr);
      if (xhairCanvas.width !== bw || xhairCanvas.height !== bh) {
        xhairCanvas.width = bw;
        xhairCanvas.height = bh;
        xhairCanvas.style.width = `${cssW}px`;
        xhairCanvas.style.height = `${cssH}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      const { time, source } = crosshairSyncStore.getState();
      if (time === null || source === slot) return; // rien à tracer (ou c'est nous la source)
      const px = chart.convertToPixel(
        { timestamp: time },
        { paneId: CANDLE_PANE_ID, absolute: true },
      ) as { x?: number };
      const x = px.x;
      if (x === undefined || !Number.isFinite(x)) return;
      const main = chart.getSize(CANDLE_PANE_ID, DomPosition.Main);
      if (!main || x < main.left || x > main.left + main.width) return;
      ctx.strokeStyle = lireTokenCanvas("--crosshair", "#8892a6");
      ctx.globalAlpha = 0.55;
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, cssH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    };
    const xhairThrottle = createRafThrottle(drawSyncedCrosshair, { minIntervalMs: 16 });
    // Ce slot survolé publie le timestamp pointé ; les autres tracent la ligne.
    const onCrosshair = (data?: Crosshair): void => {
      const t = data?.kLineData?.timestamp;
      crosshairSyncStore.setState({ time: typeof t === "number" ? t : null, source: slot });
      // Encart de lecture : bougie pointée + pixel du curseur (masqué hors survol).
      if (data?.kLineData && typeof data.x === "number" && typeof data.y === "number") {
        candleReadout.montrer(data.kLineData, data.x, data.y);
      } else {
        candleReadout.cacher();
      }
    };
    chart.subscribeAction(ActionType.OnCrosshairChange, onCrosshair);
    // Redessine la ligne synchronisée quand le crosshair partagé change OU quand le
    // viewport de CE slot bouge (le x du timestamp se recalcule).
    const unsubscribeXhairStore = crosshairSyncStore.subscribe(() => xhairThrottle.trigger());
    const onXhairViewport = (): void => xhairThrottle.trigger();
    chart.subscribeAction(ActionType.OnScroll, onXhairViewport);
    chart.subscribeAction(ActionType.OnZoom, onXhairViewport);
    chart.subscribeAction(ActionType.OnVisibleRangeChange, onXhairViewport);

    // ── Chemin store→chart : coalescence rAF des ticks WS ──────────────────
    const updateThrottle = createRafThrottle(
      () => {
        const last = store.getState().candles.at(-1);
        if (last) chart.updateData(toKLineData(last));
      },
      { minIntervalMs: TICK_MIN_INTERVAL_MS },
    );

    // ── Clic-droit pane prix → alerte prix-croise (lot B4) ─────────────────
    // getMarket lit le store injecté à chaque clic (symbole/source survivent au
    // change d'actif sans remonter l'instance KLineChart).
    const unbindPriceAlert = bindPriceAlertMenu(chart, chartDom, () => {
      const s = store.getState();
      return { symbol: s.symbol, source: s.exchange };
    });

    // Publie les objets à vie longue vers l'effet DONNÉES.
    mountRef.current = {
      chart,
      indicators,
      paneHeaders,
      overlayLegend,
      updateThrottle,
      defaultBarSpace: chart.getBarSpace(),
      defaultOffsetRight: chart.getOffsetRightDistance(),
    };

    return () => {
      // React exécute les cleanups dans l'ordre de DÉCLARATION (haut→bas) : ce cleanup
      // MONTAGE part AVANT celui de l'effet DONNÉES. Or les contrôleurs (compare, revenue,
      // dérivés, macro…) appellent `chart.removeIndicator` dans leur dispose() → ils DOIVENT
      // partir AVANT `dispose(chart)`. On invoque donc EXPLICITEMENT le teardown données ici
      // (idempotent) pendant que le chart est encore vivant, puis on démonte l'instance.
      teardownDataRef.current?.();
      unbindPriceAlert();
      unsubscribeTheme();
      unsubscribePaneHeaders();
      paneHeaders.dispose();
      overlayLegend.dispose();
      measureTool.dispose();
      candleReadout.dispose();
      unsubscribeXhairStore();
      chart.unsubscribeAction(ActionType.OnCrosshairChange, onCrosshair);
      chart.unsubscribeAction(ActionType.OnScroll, onXhairViewport);
      chart.unsubscribeAction(ActionType.OnZoom, onXhairViewport);
      chart.unsubscribeAction(ActionType.OnVisibleRangeChange, onXhairViewport);
      xhairThrottle.dispose();
      updateThrottle.dispose();
      unbindChart(chart);
      dispose(chart);
      mountRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot]);

  // ── Effet DONNÉES (deps `[exchange, symbol, timeframe, replayGen, isMaster]`) ──
  // Recrée la couche DONNÉES (dessins, contrôleurs maîtres/orderflow, backfill + WS) à
  // chaque changement d'identité de données, SANS toucher à l'instance KLineChart (partagée
  // via `mountRef`). Au teardown : désabonne/dispose TOUT sauf le chart.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const { chart, indicators, paneHeaders, overlayLegend, updateThrottle, defaultBarSpace, defaultOffsetRight } =
      mount;
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const vpCanvas = vpCanvasRef.current;
    const liqCanvas = liqCanvasRef.current;
    if (!container || !canvas || !vpCanvas || !liqCanvas) return;

    // Capture immuable de l'identité + révision de requête. Le store vide son buffer
    // AVANT tout appel réseau ; le chart impératif est vidé dans le même cycle. Une réponse,
    // pagination ou tick d'un ancien flux devra présenter CE couple identité/révision pour
    // pouvoir réécrire les données.
    const requestedIdentity: MarketIdentity = { exchange, symbol, timeframe };
    const requestId = store.getState().startDataLoad(requestedIdentity);
    if (requestId === null) return;
    // Capture par slot : un focus déplacé ne doit jamais brancher le moteur replay
    // global sur l'orderflow d'un autre graphique.
    const replayAdapter = replayGen !== 0 ? adaptateurReplayActif() : null;
    chart.clearData();
    // Neutralise le callback de pagination de l'identité précédente pendant le backfill.
    chart.setLoadDataCallback((params) => params.callback([], false));

    // Symbole/TF courants (Task 14) : nécessaires à l'AuxProvider pour les indicateurs
    // dérivés (`def.aux`) — renseignés AVANT tout sync/recompute de cet effet.
    indicators.setMarket(symbol, timeframe);

    // Lie l'instance au registre de dessin (méta actif + slot). Re-`bindChart` sur un chart
    // DÉJÀ lié REMPLACE proprement l'entrée du registre (`registry.set` écrase ; le focus,
    // tracké par référence d'INSTANCE — inchangée — n'est pas perturbé) → aucun
    // `updateChartMeta` dédié nécessaire. Le focus reprend la main si ce slot est le focus.
    bindChart(chart, { exchange, symbol }, slot);
    if (chartLayoutStore.getState().focus === slot) setFocusChart(slot);

    // Indicateurs : abonnement qui CAPTURE `exchange` (recréé à chaque changement de données
    // pour lire la bonne source). Chaque slot calcule sur SON buffer.
    const unsubscribeIndicators = indicatorsStore.subscribe((state) => {
      indicators.sync(state.indicators, store.getState().candles, exchange);
    });

    // Échelle de l'axe prix (partagée) : appliquée à l'instance + propagée au footprint.
    const applyPriceScale = (type: PriceScaleType): void => {
      chart.setStyles({ yAxis: { type: Y_AXIS_TYPE[type] } });
      orderflow?.setAxisType(type);
    };
    const unsubscribePriceScale = priceScaleStore.subscribe((state) => applyPriceScale(state.type));

    // ── ORDERFLOW réservé au slot FOCUS (perf) ─────────────────────────────
    // Créé/détruit selon (ce slot est focus) ET (toggle Orderflow global actif). Lit le
    // buffer de CE slot (store injecté). Recréé au changement de focus/toggle, jamais par tick.
    let orderflow: OrderflowController | null = null;
    const ensureOrderflow = (): void => {
      const want = chartLayoutStore.getState().focus === slot && orderflowStore.getState().enabled;
      if (want && !orderflow) {
        orderflow = new OrderflowController(chart, container, canvas, symbol, store, replayAdapter);
        orderflow.setAxisType(priceScaleStore.getState().type);
        orderflow.setEnabled(true);
        if (store.getState().candles.length > 0) orderflow.onCandles();
      } else if (!want && orderflow) {
        orderflow.dispose();
        orderflow = null;
      }
    };
    const unsubscribeFocusOf = chartLayoutStore.subscribe(ensureOrderflow);
    const unsubscribeOrderflow = orderflowStore.subscribe(ensureOrderflow);

    // ── Contrôleurs LOURDS : slot MAÎTRE uniquement (lisent les stores globaux) ──
    let compare: CompareController | null = null;
    let volumeProfile: VolumeProfileController | null = null;
    let liqHeat: LiquidationHeatController | null = null;
    let revenue: RevenueController | null = null;
    let macro: MacroController | null = null;
    let derivativesChart: DerivativesChartController | null = null;
    let unsubscribeCompare: (() => void) | null = null;
    let unsubscribeVolumeProfile: (() => void) | null = null;
    let unsubscribeLiqHeat: (() => void) | null = null;
    let unsubscribeRevenue: (() => void) | null = null;
    let unsubscribeMacro: (() => void) | null = null;
    let unsubscribeMacroHistory: (() => void) | null = null;
    let unsubscribeFib: (() => void) | null = null;

    if (isMaster) {
      compare = new CompareController(chart, exchange, timeframe);
      unsubscribeCompare = compareStore.subscribe((state) => compare?.sync(state.symbols));

      volumeProfile = new VolumeProfileController(chart, container, vpCanvas);
      volumeProfile.setEnabled(volumeProfileStore.getState().enabled);
      unsubscribeVolumeProfile = volumeProfileStore.subscribe((state) => volumeProfile?.setEnabled(state.enabled));

      // Heatmap liquidations 2D (canvas) : lit le buffer d'événements publié par le singleton
      // WS de liquidationMarkers ; la bascule LIQMARK pilote son activation.
      liqHeat = new LiquidationHeatController(chart, container, liqCanvas);
      liqHeat.setEnabled(liqMarksStore.getState().actif);
      unsubscribeLiqHeat = liqMarksStore.subscribe((state) => liqHeat?.setEnabled(state.actif));

      revenue = new RevenueController(chart, symbol);
      revenue.setEnabled(revenueStore.getState().enabled);
      unsubscribeRevenue = revenueStore.subscribe((state) => revenue?.setEnabled(state.enabled));

      macro = new MacroController(chart);
      macro.sync(macroOverlayStore.getState().enabled);
      unsubscribeMacro = macroOverlayStore.subscribe((state) => macro?.sync(state.enabled));
      unsubscribeMacroHistory = macroHistoryStore.subscribe(() => macro?.onCandles());

      // Réglages Fibonacci : re-rend les overlays Fibo tracés (toutes instances).
      unsubscribeFib = fibStore.subscribe((state) => redrawFibOverlays(state.rev));
    }

    // Contrôleur dérivés SUR le chart (OI + funding), AUTONOME (s'abonne lui-même) — sur
    // TOUS les slots (plus seulement le maître) : un slot secondaire doit pouvoir afficher
    // ses propres sous-panes OI/FUND. Le fetch Coinalyze est mémoïsé par symbole
    // (derivatives.ts) pour ne pas doubler les appels quand deux slots partagent le même actif.
    derivativesChart = new DerivativesChartController(chart, symbol, store);

    // Garde anti-course : les callbacks asynchrones (backfill, pagination, resync) ne doivent
    // rien faire après le teardown. Sert aussi de garde d'idempotence au teardown lui-même.
    let cancelled = false;
    let unsubscribe: Unsubscribe | null = null;
    // En replay, ce slot lit le MOTEUR de rejeu (même surface IExchangeAdapter → tout le
    // pipeline live fonctionne inchangé) au lieu du flux WS de l'exchange ; sinon la source
    // du slot. Le footprint/CVD (OrderflowController) résout le même adaptateur de son côté.
    // 1) Backfill REST, puis 2) live WS.
    // La résolution de l'adaptateur passe elle aussi dans la chaîne Promise : une source
    // persistée invalide qui ferait lever `getAdapter` devient un état d'erreur récupérable.
    Promise.resolve()
      .then(() => replayAdapter ?? getAdapter(exchange))
      .then((adapter) =>
        adapter.fetchKlines(symbol, timeframe, { limit: 500 }).then((candles) => ({ adapter, candles })),
      )
      .then(({ adapter, candles }) => {
        if (cancelled) return;
        const current = store.getState();
        if (
          current.dataLoad.requestId !== requestId ||
          !sameMarketIdentity(marketIdentity(current), requestedIdentity)
        ) return;

        chart.setPriceVolumePrecision(derivePricePrecision(candles), 0);
        chart.applyNewData(candles.map(toKLineData));
        // Le store et la série deviennent « ready » dans le même tour JS. Si l'identité
        // a changé depuis la garde ci-dessus, le commit est refusé et le chart est repurgé.
        if (!store.getState().completeDataLoad(requestedIdentity, requestId, candles)) {
          chart.clearData();
          return;
        }

        // Préservation best-effort du cadrage (même source ET même actif — un changement
        // de TF conserve le zoom relatif). Sur un vrai changement d'actif, klinecharts ne
        // réinitialise jamais lui-même barSpace/offsetRightDistance (seul le range visible
        // l'est) : sans ce `else`, le cadrage de l'actif précédent reste appliqué tel quel
        // et peut produire un range visible dégénéré sur la nouvelle série (axe qui ne
        // s'adapte plus, bougies minuscules ou disparues).
        const vp = lastViewport.get(slot);
        try {
          if (vp && vp.exchange === exchange && vp.symbol === symbol) {
            chart.setBarSpace(vp.barSpace);
            chart.setOffsetRightDistance(vp.offsetRight);
          } else {
            chart.setBarSpace(defaultBarSpace);
            chart.setOffsetRightDistance(defaultOffsetRight);
          }
        } catch {
          /* best-effort */
        }

        // Rejoue les dessins sauvegardés de CE slot (bougies posées : ancrage valide).
        restoreDrawings(chart, exchange, symbol);
        // Indicateurs actifs sur le buffer de CE slot. `forceRecompute` : un backfill
        // charge un TOUT NOUVEAU buffer (nouvel actif/TF/source) — une instance à
        // params inchangés doit être recalculée quand même, sinon elle garde
        // l'`extendData` de l'ANCIEN actif (échelle de prix potentiellement sans
        // rapport) et fausse l'auto-scale de l'axe Y du pane prix.
        indicators.sync(indicatorsStore.getState().indicators, candles, exchange, true);
        // `indicators.sync` ci-dessus est un appel DIRECT (pas une mutation
        // `indicatorsStore`) : l'abonnement `unsubscribePaneHeaders` (effet MONTAGE) ne se
        // déclenche donc pas ici. Pour des indicateurs déjà persistés, c'est le SEUL moment
        // où leurs panes séparés sont réellement créés — sans cet appel, `paneHeaders.sync()`
        // ne verrait pas les panes et les croix ✕/drag resteraient invisibles tant que
        // l'utilisateur ne modifie pas `indicatorsStore` lui-même.
        paneHeaders.sync();
        overlayLegend.sync();
        // Orderflow (si ce slot est focus + activé) : reseed CVD + trades.
        ensureOrderflow();
        orderflow?.onCandles();
        // Échelle d'axe : réapplique l'échelle partagée courante au nouveau jeu de données.
        applyPriceScale(priceScaleStore.getState().type);
        // Contrôleurs lourds (maître).
        compare?.sync(compareStore.getState().symbols);
        volumeProfile?.onCandles();
        revenue?.onCandles();
        macro?.onCandles();

        // Pagination historique (scroll gauche) — prépend au buffer + au graphe.
        chart.setLoadDataCallback((params) => {
          const leftmost = params.data;
          if (params.type !== LoadDataType.Forward || !leftmost) {
            params.callback([], false);
            return;
          }
          const beforeFetch = store.getState();
          if (
            !isMarketDataReady(beforeFetch, requestedIdentity, requestId) ||
            beforeFetch.candles.length >= PAGINATION_MAX_CANDLES
          ) {
            params.callback([], false);
            return;
          }
          adapter
            .fetchKlines(symbol, timeframe, { limit: PAGINATION_LIMIT, endTime: leftmost.timestamp - 1 })
            .then((fetched) => {
              if (cancelled || !isMarketDataReady(store.getState(), requestedIdentity, requestId)) {
                params.callback([], false);
                return;
              }
              const older = fetched.filter((c) => c.time < leftmost.timestamp);
              if (older.length === 0) {
                params.callback([], false);
                return;
              }
              const existing = store.getState().candles;
              const merged = older.concat(existing);
              store.getState().setCandles(merged);
              indicators.recompute(indicatorsStore.getState().indicators, merged, exchange);
              orderflow?.onCandles();
              compare?.onCandles();
              volumeProfile?.onCandles();
              revenue?.onCandles();
              macro?.onCandles();
              params.callback(older.map(toKLineData), true);
            })
            .catch((err) => {
              if (!cancelled) params.callback([], true);
              console.error("[AXIOM] pagination historique échouée", err);
            });
        });

        const onKline = (candle: Candle) => {
          // Un callback WS peut être déjà en file lors du changement de symbole. La garde
          // identité+révision empêche ce dernier tick de repeupler le buffer invalidé.
          if (!store.getState().upsertCandleFor(requestedIdentity, requestId, candle)) return;
          // Coalescence rAF des ticks intra-bougie ; flush IMMÉDIAT à la clôture pour
          // finaliser exactement la bougie fermée sur le graphe.
          if (candle.closed) {
            updateThrottle.flushNow();
          } else {
            updateThrottle.trigger();
            // Recalcul indicateurs intra-bougie, throttlé 500 ms (leading+trailing) : la
            // bougie en formation bouge, on veut le RSI/etc. à jour sans recalculer à
            // chaque tick WS. La clôture (branche ci-dessus) garde `recompute` direct.
            indicators.recomputeThrottled(indicatorsStore.getState().indicators, store.getState().candles, exchange);
          }

          orderflow?.onTick();

          if (candle.closed) {
            indicators.recompute(indicatorsStore.getState().indicators, store.getState().candles, exchange);
            compare?.onCandles();
            volumeProfile?.onCandles();
            revenue?.onCandles();
            macro?.onCandles();
          }
        };

        // Resync post-reconnexion WS : prepareResyncApply encode la règle
        // (appliquer si fetched.length > 0, jamais sur égalité de longueur seule).
        // Buffer de même cardinalité peut avoir un contenu différent → CVD reseed
        // via orderflow.onCandles → refreshCvd. Lot A0.4.
        const onResync = (fetched: Candle[]) => {
          if (cancelled || !isMarketDataReady(store.getState(), requestedIdentity, requestId)) return;
          const merged = prepareResyncApply(store.getState().candles, fetched);
          if (!merged) return;
          store.getState().setCandles(merged);
          chart.applyNewData(merged.map(toKLineData));
          orderflow?.onCandles();
          indicators.recompute(indicatorsStore.getState().indicators, merged, exchange);
          compare?.onCandles();
          volumeProfile?.onCandles();
          revenue?.onCandles();
          macro?.onCandles();
        };

        const subscribeKline = adapter.subscribeKline as SubscribeKlineAvecResync;
        unsubscribe = subscribeKline(symbol, timeframe, onKline, onResync);
      })
      .catch((err) => {
        if (cancelled) return;
        const failed = store.getState().failDataLoad(
          requestedIdentity,
          requestId,
          dataLoadErrorMessage(err),
        );
        if (failed) {
          chart.clearData();
          chart.setLoadDataCallback((params) => params.callback([], false));
        }
        console.error("[AXIOM] Échec du backfill", err);
      });

    // Teardown de la couche DONNÉES : tout sauf le chart. Exposé via `teardownDataRef` pour
    // que le cleanup MONTAGE puisse l'exécuter AVANT `dispose(chart)` au démontage. Le drapeau
    // `cancelled` garantit l'idempotence (invoqué au plus une fois par run d'effet).
    const teardownData = (): void => {
      if (cancelled) return;
      cancelled = true;
      indicators.disposeThrottle();
      unsubscribeIndicators();
      unsubscribePriceScale();
      unsubscribeFocusOf();
      unsubscribeOrderflow();
      unsubscribeCompare?.();
      unsubscribeVolumeProfile?.();
      unsubscribeLiqHeat?.();
      unsubscribeRevenue?.();
      unsubscribeMacro?.();
      unsubscribeMacroHistory?.();
      unsubscribeFib?.();
      derivativesChart?.dispose();
      macro?.dispose();
      revenue?.dispose();
      liqHeat?.dispose();
      volumeProfile?.dispose();
      compare?.dispose();
      orderflow?.dispose();
      if (unsubscribe) unsubscribe();
      // Purge les dessins de l'ANCIEN symbole sur CETTE instance réutilisée (persist-safe :
      // le stockage n'est PAS écrasé ; marqueurs éco + indicateurs préservés). Rejoués par
      // `restoreDrawings` au prochain run si on revient sur ce symbole.
      purgeChartDrawings(chart);
      // Capture le cadrage courant (restauré au prochain run/montage même source).
      try {
        lastViewport.set(slot, {
          exchange,
          symbol,
          barSpace: chart.getBarSpace(),
          offsetRight: chart.getOffsetRightDistance(),
        });
      } catch {
        lastViewport.delete(slot);
      }
    };
    teardownDataRef.current = teardownData;
    return teardownData;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exchange, symbol, timeframe, replayGen, isMaster, retryRevision]);

  return (
    // Conteneur relatif : le graphe le remplit ; les canvases se superposent
    // (pointer-events:none → pan/zoom passent au graphe). Clic = focus de ce slot.
    <div
      ref={containerRef}
      className={`relative h-full w-full ${isFocus ? "ring-1 ring-accent/70 ring-inset" : ""}`}
      onMouseDownCapture={() => {
        if (chartLayoutStore.getState().focus !== slot) chartLayoutStore.getState().setFocus(slot);
        setFocusChart(slot);
      }}
    >
      <div ref={chartRef} className="absolute inset-0" />
      {/* Bannière REPLAY (roadmap 4.4) : visible tant que ce slot rejoue un jour passé. */}
      {replayLabel !== "" && (
        <div className="pointer-events-none absolute left-1/2 top-1 z-20 -translate-x-1/2 rounded border border-accent/60 bg-surface/90 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-accent backdrop-blur">
          ⏵ REPLAY · {replayLabel}
        </div>
      )}
      {/* Orderflow réservé au slot focus (perf) : badge explicite sur les AUTRES slots pour
          rappeler pourquoi leur footprint/CVD est inactif. Masqué en mono-chart (un seul
          slot = toujours le focus, le badge serait toujours absent de toute façon). */}
      {orderflowEnabled && !isFocus && layout !== "1" && (
        <div className="pointer-events-none absolute right-1 top-1 z-20 rounded border border-border bg-surface/80 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-dim">
          Orderflow · slot focus
        </div>
      )}
      {isMaster ? (
        <SymbolBanner />
      ) : (
        <SecondaryHeader
          exchange={exchange}
          symbol={symbol}
          timeframe={timeframe}
          onChangeSymbol={onChangeSymbol}
          onChangeTimeframe={onChangeTimeframe}
          onChangeExchange={onChangeExchange}
        />
      )}
      <canvas ref={vpCanvasRef} className="pointer-events-none absolute inset-0" style={{ display: "none" }} />
      <canvas ref={liqCanvasRef} className="pointer-events-none absolute inset-0" style={{ display: "none" }} />
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0" style={{ display: "none" }} />
      <canvas ref={xhairCanvasRef} className="pointer-events-none absolute inset-0" />
      <ChartDataStatusOverlay
        state={dataLoad}
        requested={{ exchange, symbol, timeframe }}
        onRetry={() => setRetryRevision((revision) => revision + 1)}
      />
    </div>
  );
}

function identityLabel(identity: MarketIdentity): string {
  return `${identity.symbol} · ${identity.timeframe} · ${identity.exchange}`;
}

/**
 * Cache intégralement la série impérative tant que son identité n'est pas confirmée.
 * L'opacité est volontairement totale : même le frame précédant le cleanup de l'ancien
 * effet ne peut pas présenter ses bougies sous le nouvel en-tête React.
 */
function ChartDataStatusOverlay({
  state,
  requested,
  onRetry,
}: {
  state: MarketDataLoadState;
  requested: MarketIdentity;
  onRetry: () => void;
}) {
  const requestMatches = sameMarketIdentity(state.requested, requested);
  const status = requestMatches && state.status !== "idle" ? state.status : "loading";
  if (status === "ready" && sameMarketIdentity(state.loaded, requested)) return null;

  const hiddenSnapshot = state.loaded;
  const isError = status === "error";

  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-bg px-4"
      data-chart-status={status}
      data-stale={hiddenSnapshot !== null ? "true" : "false"}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      aria-busy={!isError}
    >
      <div className="max-w-sm rounded border border-border bg-surface px-4 py-3 text-center shadow-lg">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-text">
          {isError ? "Données indisponibles" : "Chargement des bougies…"}
        </p>
        <p className="mt-1 break-all font-mono text-[10px] text-text-dim">
          {identityLabel(requested)}
        </p>
        {isError && (
          <p className="mt-2 text-[11px] text-down">
            {requestMatches && state.status === "error"
              ? state.error
              : "La source n’a pas pu fournir l’historique demandé."}
          </p>
        )}
        {hiddenSnapshot !== null && (
          <p className="mt-2 text-[10px] text-text-dim">
            {sameMarketIdentity(hiddenSnapshot, requested)
              ? "Le dernier jeu chargé est masqué pendant ce rafraîchissement."
              : `Anciennes données masquées : ${identityLabel(hiddenSnapshot)}.`}
          </p>
        )}
        {isError && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 rounded border border-accent/60 bg-accent/15 px-3 py-1 text-[11px] font-semibold text-accent transition hover:bg-accent/25"
          >
            Réessayer
          </button>
        )}
      </div>
    </div>
  );
}

/** En-tête compact d'un slot secondaire : symbole (éditable) + TF + source. */
function SecondaryHeader({
  exchange,
  symbol,
  timeframe,
  onChangeSymbol,
  onChangeTimeframe,
  onChangeExchange,
}: {
  exchange: ExchangeId;
  symbol: string;
  timeframe: Timeframe;
  onChangeSymbol?: (symbol: string) => void;
  onChangeTimeframe?: (tf: Timeframe) => void;
  onChangeExchange?: (ex: ExchangeId) => void;
}) {
  return (
    <div className="pointer-events-auto absolute left-1 top-1 z-20 flex items-center gap-1 rounded bg-surface/80 px-1 py-0.5 text-[10px] backdrop-blur">
      <input
        aria-label="Symbole du slot"
        defaultValue={symbol}
        key={symbol}
        onKeyDown={(e) => {
          if (e.key === "Enter") onChangeSymbol?.((e.target as HTMLInputElement).value.trim());
        }}
        onBlur={(e) => onChangeSymbol?.(e.target.value.trim())}
        className={`w-20 rounded bg-bg px-1 py-0.5 font-mono text-text outline-none focus:ring-1 focus:ring-accent/60 ${exchange === "synthetic" ? "" : "uppercase"}`}
      />
      <select
        aria-label="Timeframe du slot"
        value={timeframe}
        onChange={(e) => onChangeTimeframe?.(e.target.value as Timeframe)}
        className="rounded bg-bg px-0.5 py-0.5 text-text outline-none"
      >
        {SECONDARY_TFS.map((tf) => (
          <option key={tf} value={tf}>
            {tf}
          </option>
        ))}
      </select>
      <select
        aria-label="Source du slot"
        value={exchange}
        onChange={(e) => onChangeExchange?.(e.target.value as ExchangeId)}
        className="rounded bg-bg px-0.5 py-0.5 text-text outline-none"
      >
        {SECONDARY_SOURCES.filter((s) => s.id !== "synthetic" || exchange === "synthetic").map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}
