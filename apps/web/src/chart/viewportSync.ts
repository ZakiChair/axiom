/** Synchronisation des dates visibles entre instances KLineChart, hors boucle React. */
import { ActionType, DomPosition, type Chart, type KLineData } from "klinecharts";
import { chartLayoutStore, visibleSlotCount } from "../store/chart-layout";
import { isMarketDataReady, marketIdentity, type MarketStore } from "../store/market";
import { replayStore } from "../store/replay";
import { createRafThrottle, type RafThrottle } from "./rafThrottle";

interface PlageTemporelle { from: number; to: number }
interface Entree {
  chart: Chart;
  store: MarketStore;
  slot: number;
  dernierTemps: number | undefined;
  requeteObservee: number;
}

// Interpolation sur les dates réelles : mois calendaires et trous de cotation compris.
// Hors buffer, seuls les intervalles de bord sont extrapolés ; aucune bougie n'est créée.
function tempsPourIndex(data: KLineData[], index: number): number {
  const i = Math.max(0, Math.min(data.length - 2, Math.floor(index)));
  const a = data[i]!, b = data[i + 1]!;
  return a.timestamp + (index - i) * (b.timestamp - a.timestamp);
}

function indexPourTemps(data: KLineData[], time: number): number {
  let low = 0, high = data.length - 1;
  while (low + 1 < high) {
    const mid = Math.floor((low + high) / 2);
    if (data[mid]!.timestamp <= time) low = mid;
    else high = mid;
  }
  const a = data[low]!, b = data[low + 1]!;
  return low + (time - a.timestamp) / (b.timestamp - a.timestamp);
}

function pixelPourIndex(chart: Chart, index: number): number | undefined {
  const point = chart.convertToPixel({ dataIndex: index }, { paneId: "candle_pane" });
  return Array.isArray(point) ? undefined : point.x;
}

/** Dates aux bords de la zone de tracé, indépendantes de l'origine du buffer. */
export function lirePlageTemporelle(chart: Chart): PlageTemporelle | null {
  const data = chart.getDataList();
  const width = chart.getSize("candle_pane", DomPosition.Main)?.width ?? 0;
  const space = chart.getBarSpace();
  if (data.length < 2 || width <= 0 || space <= 0) return null;
  const anchor = Math.max(0, Math.min(data.length - 1, chart.getVisibleRange().from));
  const x = pixelPourIndex(chart, anchor);
  if (x === undefined || !Number.isFinite(x)) return null;
  const left = anchor - x / space;
  const from = tempsPourIndex(data, left), to = tempsPourIndex(data, left + width / space);
  return Number.isFinite(from) && Number.isFinite(to) && to > from ? { from, to } : null;
}

function appliquerPlage(chart: Chart, range: PlageTemporelle): void {
  const data = chart.getDataList();
  const width = chart.getSize("candle_pane", DomPosition.Main)?.width ?? 0;
  if (data.length < 2 || width <= 0) return;
  const left = indexPourTemps(data, range.from), right = indexPourTemps(data, range.to);
  if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) return;
  // Limites documentées du moteur v9 : 1 à 50 px/bougie. Une vue très courte ou
  // une TF différente peut atteindre cette borne ; on conserve alors la date centrale.
  const space = Math.max(1, Math.min(50, width / (right - left)));
  if (Math.abs(chart.getBarSpace() - space) > 0.001) chart.setBarSpace(space);
  const center = (left + right) / 2;
  const x = pixelPourIndex(chart, center);
  if (x !== undefined && Number.isFinite(x) && Math.abs(x - width / 2) > 0.75) {
    // KLineChart v9 déplace les bougies vers la droite pour une distance positive.
    chart.scrollByDistance(width / 2 - x);
  }
}

const entrees = new Map<number, Entree>();
const aRestaurer = new Set<number>();
let dernier: { source: number; range: PlageTemporelle } | null = null;
let aPublier: number | null = null;
let application = false;
let throttle: RafThrottle | null = null;
let arreterPreferences: (() => void) | null = null;
let arreterReplay: (() => void) | null = null;

function visibleEtLive(slot: number): boolean {
  const layout = chartLayoutStore.getState();
  const replay = replayStore.getState();
  return slot < visibleSlotCount(layout.layout) &&
    !((replay.active || replay.identityTransition) && replay.slot === slot);
}

function prete(entry: Entree): boolean {
  if (!visibleEtLive(entry.slot)) return false;
  const state = entry.store.getState();
  const data = entry.chart.getDataList();
  return isMarketDataReady(state, marketIdentity(state), state.dataLoad.requestId) &&
    data.length >= 2 && data.length === state.candles.length &&
    data[0]?.timestamp === state.candles[0]?.time &&
    data.at(-1)?.timestamp === state.candles.at(-1)?.time;
}

function executer(): void {
  if (!chartLayoutStore.getState().syncViewport) return;
  if (dernier && !visibleEtLive(dernier.source)) dernier = null;
  let source = aPublier === null ? undefined : entrees.get(aPublier);
  aPublier = null;
  if (source && !prete(source)) source = undefined;
  if (!dernier && !source) {
    const focus = entrees.get(chartLayoutStore.getState().focus);
    source = focus && prete(focus) ? focus : [...entrees.values()].find(prete);
  }
  if (source) {
    const range = lirePlageTemporelle(source.chart);
    if (range) {
      dernier = { source: source.slot, range };
      for (const slot of entrees.keys()) if (slot !== source.slot) aRestaurer.add(slot);
      aRestaurer.delete(source.slot);
    }
  }
  if (!dernier) return;
  application = true;
  try {
    for (const slot of [...aRestaurer]) {
      const entry = entrees.get(slot);
      if (!entry || !prete(entry)) continue;
      aRestaurer.delete(slot);
      appliquerPlage(entry.chart, dernier.range);
    }
  } finally {
    application = false;
  }
}

function restaurer(slot: number): void {
  if (application || !chartLayoutStore.getState().syncViewport) return;
  aRestaurer.add(slot);
  throttle?.trigger();
}

/** Branche un slot ; le dernier démontage ferme tous les abonnements partagés. */
export function bindViewportSync(chart: Chart, store: MarketStore, slot: number): () => void {
  const entry: Entree = {
    chart, store, slot,
    dernierTemps: chart.getDataList().at(-1)?.timestamp,
    requeteObservee: store.getState().dataLoad.requestId,
  };
  entrees.set(slot, entry);
  if (!throttle) {
    throttle = createRafThrottle(executer, { minIntervalMs: 16 });
    arreterPreferences = chartLayoutStore.subscribe((state, prev) => {
      if (state.syncViewport !== prev.syncViewport) {
        dernier = null;
        aPublier = state.syncViewport ? state.focus : null;
        aRestaurer.clear();
      }
      if (state.syncViewport !== prev.syncViewport || state.layout !== prev.layout) {
        for (const position of entrees.keys()) restaurer(position);
      }
    });
    arreterReplay = replayStore.subscribe((state, prev) => {
      if (state.active !== prev.active || state.identityTransition !== prev.identityTransition || state.slot !== prev.slot) {
        for (const position of entrees.keys()) restaurer(position);
      }
    });
  }
  const onNavigation = (): void => {
    if (application || !chartLayoutStore.getState().syncViewport || !prete(entry)) return;
    aPublier = slot;
    throttle?.trigger();
  };
  const onRange = (): void => restaurer(slot);
  const onData = (): void => {
    const last = chart.getDataList().at(-1)?.timestamp;
    const request = store.getState().dataLoad.requestId;
    // Une nouvelle bougie LIVE peut faire avancer le cadrage du meneur. Un nouveau
    // chargement, lui, doit retrouver la période partagée après applyNewData.
    if (dernier?.source === slot && request === entry.requeteObservee && last !== entry.dernierTemps) onNavigation();
    else restaurer(slot);
    entry.dernierTemps = last;
    entry.requeteObservee = request;
  };
  const arreterMarche = store.subscribe((state, prev) => {
    if (state.timeframe !== prev.timeframe && dernier?.source === slot) dernier = null;
    if (state.dataLoad !== prev.dataLoad) restaurer(slot);
  });
  chart.subscribeAction(ActionType.OnScroll, onNavigation);
  chart.subscribeAction(ActionType.OnZoom, onNavigation);
  chart.subscribeAction(ActionType.OnVisibleRangeChange, onRange);
  chart.subscribeAction(ActionType.OnDataReady, onData);
  restaurer(slot);
  return () => {
    arreterMarche();
    chart.unsubscribeAction(ActionType.OnScroll, onNavigation);
    chart.unsubscribeAction(ActionType.OnZoom, onNavigation);
    chart.unsubscribeAction(ActionType.OnVisibleRangeChange, onRange);
    chart.unsubscribeAction(ActionType.OnDataReady, onData);
    entrees.delete(slot);
    aRestaurer.delete(slot);
    if (aPublier === slot) aPublier = null;
    if (dernier?.source === slot) dernier = null;
    if (entrees.size === 0) {
      throttle?.dispose();
      throttle = null;
      arreterPreferences?.();
      arreterReplay?.();
      arreterPreferences = arreterReplay = null;
      aRestaurer.clear();
    }
  };
}
