import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionType, type Chart, type KLineData } from "klinecharts";
import { chartLayoutStore } from "../store/chart-layout";
import { createMarketStore, marketIdentity } from "../store/market";
import { replayStore } from "../store/replay";
import { bindViewportSync, lirePlageTemporelle } from "./viewportSync";

// Le bundle UMD n'exporte pas ses constantes hors navigateur.
vi.mock("klinecharts", () => ({
  ActionType: { OnScroll: "onScroll", OnZoom: "onZoom", OnVisibleRangeChange: "onVisibleRangeChange", OnDataReady: "onDataReady" },
  DomPosition: { Main: "main" },
}));

// Double du moteur canvas uniquement : les stores et le contrôleur sont réels.
function graphe(debut: number, count: number, width = 600) {
  const data: KLineData[] = Array.from({ length: count }, (_, i) => ({
    timestamp: debut + i * 60_000, open: 100, high: 102, low: 99, close: 101, volume: 1,
  }));
  let space = 10;
  let leftIndex = count - 50;
  let mutations = 0;
  const listeners = new Map<ActionType, Set<() => void>>();
  const emit = (action: ActionType) => listeners.get(action)?.forEach((cb) => cb());
  const api = {
    getDataList: () => data,
    getBarSpace: () => space,
    getSize: () => ({ width, height: 300, left: 0, right: width, top: 0, bottom: 300 }),
    getVisibleRange: () => ({ from: Math.max(0, Math.floor(leftIndex)), to: Math.min(count, Math.ceil(leftIndex + width / space)) }),
    convertToPixel: ({ dataIndex }: { dataIndex: number }) => ({ x: (dataIndex - leftIndex) * space }),
    setBarSpace: (next: number) => { space = next; mutations++; emit(ActionType.OnVisibleRangeChange); },
    scrollByDistance: (distance: number) => { leftIndex -= distance / space; mutations++; emit(ActionType.OnVisibleRangeChange); emit(ActionType.OnScroll); },
    subscribeAction: (action: ActionType, cb: () => void) => {
      if (!listeners.has(action)) listeners.set(action, new Set());
      listeners.get(action)!.add(cb);
    },
    unsubscribeAction: (action: ActionType, cb: () => void) => listeners.get(action)?.delete(cb),
  } as unknown as Chart;
  const store = createMarketStore({ exchange: "binance", symbol: "BTCUSDT", timeframe: "1m" });
  const ready = () => {
    const identity = marketIdentity(store.getState());
    const requestId = store.getState().startDataLoad(identity)!;
    store.getState().completeDataLoad(identity, requestId, data.map((c) => ({
      time: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0,
    })));
    emit(ActionType.OnDataReady);
  };
  ready();
  return { api, store, ready, emit, mutations: () => mutations, resize: (w: number) => { width = w; emit(ActionType.OnVisibleRangeChange); } };
}

const cleanups: Array<() => void> = [];
beforeEach(() => {
  vi.useFakeTimers();
  chartLayoutStore.setState({ layout: "2h", focus: 0, syncViewport: false });
  replayStore.setState({ active: false, identityTransition: false });
});
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.useRealTimers();
});
const frame = () => vi.advanceTimersByTime(20);

describe("synchronisation des dates visibles", () => {
  it("aligne les dates et le zoom malgré des origines et largeurs différentes, sans écho", () => {
    const source = graphe(0, 200);
    const cible = graphe(60 * 60_000, 140, 900);
    cleanups.push(bindViewportSync(source.api, source.store, 0), bindViewportSync(cible.api, cible.store, 1));
    chartLayoutStore.setState({ syncViewport: true });
    frame();
    expect(lirePlageTemporelle(cible.api)).toEqual({ from: 9_000_000, to: 12_600_000 });
    expect(cible.api.getBarSpace()).toBe(15);
    source.api.scrollByDistance(200);
    frame();
    expect(lirePlageTemporelle(cible.api)).toEqual({ from: 7_800_000, to: 11_400_000 });
    const mutations = [source.mutations(), cible.mutations()];
    vi.advanceTimersByTime(500);
    expect([source.mutations(), cible.mutations()]).toEqual(mutations);
  });

  it("propage aussi un zoom depuis un secondaire puis cesse à la désactivation", () => {
    const a = graphe(0, 200), b = graphe(0, 200);
    cleanups.push(bindViewportSync(a.api, a.store, 0), bindViewportSync(b.api, b.store, 1));
    chartLayoutStore.setState({ syncViewport: true });
    frame();
    b.api.setBarSpace(20);
    b.emit(ActionType.OnZoom);
    frame();
    expect(a.api.getBarSpace()).toBe(20);
    chartLayoutStore.setState({ syncViewport: false });
    b.api.scrollByDistance(-200);
    frame();
    expect(lirePlageTemporelle(a.api)).toEqual({ from: 9_000_000, to: 10_800_000 });
    expect(lirePlageTemporelle(b.api)).toEqual({ from: 9_600_000, to: 11_400_000 });
  });

  it("rattrape une cible chargée plus tard et garde la période après redimensionnement", () => {
    const a = graphe(0, 200), b = graphe(0, 200);
    b.store.getState().startDataLoad(marketIdentity(b.store.getState()));
    cleanups.push(bindViewportSync(a.api, a.store, 0), bindViewportSync(b.api, b.store, 1));
    chartLayoutStore.setState({ syncViewport: true });
    a.api.scrollByDistance(300);
    frame();
    expect(b.mutations()).toBe(0);
    b.ready();
    frame();
    expect(lirePlageTemporelle(b.api)).toEqual({ from: 7_200_000, to: 10_800_000 });
    b.resize(900);
    frame();
    expect(b.api.getBarSpace()).toBe(15);
    expect(lirePlageTemporelle(b.api)).toEqual({ from: 7_200_000, to: 10_800_000 });
  });

  it("exclut les slots masqués et le replay, puis désabonne au démontage", () => {
    const a = graphe(0, 200), b = graphe(0, 200), cache = graphe(0, 200);
    cleanups.push(bindViewportSync(a.api, a.store, 0), bindViewportSync(b.api, b.store, 1), bindViewportSync(cache.api, cache.store, 2));
    replayStore.setState({ active: true, slot: 1, symbole: "ETHUSDT", tf: "1m" });
    chartLayoutStore.setState({ syncViewport: true });
    a.api.scrollByDistance(-300);
    frame();
    expect(b.mutations()).toBe(0);
    expect(cache.mutations()).toBe(0);
    cleanups.splice(0).forEach((cleanup) => cleanup());
    a.api.scrollByDistance(100);
    frame();
    expect(b.mutations()).toBe(0);
  });
});
