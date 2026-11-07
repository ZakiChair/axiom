/**
 * Colonnes historiques du footprint reconstruites en intrabar : une bougie jamais vue en
 * live passe de la répartition uniforme (« ≈+delta ») à la répartition par sous-bougie
 * une fois les klines 1m chargées ; la bougie en cours reste « ≈ », y compris en replay
 * où seul son drapeau `closed:false` la désigne ; la légende dit la résolution réelle et
 * la couverture. `fetch` est une doublure : aucun appel réseau.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Candle, ExchangeId } from "@axiom/types";
import type { Chart } from "klinecharts";
import type { MarketStore } from "../store/market";

vi.mock("klinecharts", () => ({
  registerIndicator: () => {},
  registerOverlay: () => {},
  ActionType: { OnScroll: "onScroll", OnVisibleRangeChange: "onVisibleRangeChange", OnZoom: "onZoom" },
  DomPosition: { Main: "main" },
  IndicatorSeries: { Normal: "normal", Price: "price", Volume: "volume" },
}));
vi.mock("../lib/canvasTokens", () => ({ lireTokenCanvas: (_n: string, repli: string) => repli }));
// Ni flux WebSocket ni exchangeInfo : le footprint reste sans ticks, tout passe par l'historique.
vi.mock("../data/adapters", () => ({ getAdapter: () => ({ subscribeTrades: () => () => {} }) }));
vi.mock("../data/binance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/binance")>()),
  fetchSymbolInfo: () => new Promise<never>(() => {}),
}));

import { OrderflowController } from "./orderflow";
import { ANTI_REBOND_MS } from "../data/intrabar";

const MIN = 60_000;
const H1 = 60 * MIN;
const MAINTENANT = Date.UTC(2026, 10, 7, 12, 7, 0);

function minute(t: number): Candle {
  const k = t / MIN;
  const base = 3_000 + 20 * Math.sin(k / 90);
  const open = base + 3 * Math.sin(k);
  const close = base + 3 * Math.cos(k);
  const volume = 5 + 4 * Math.abs(Math.sin(k * 0.37));
  return { time: t, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume, buyVolume: volume * (0.5 + 0.4 * Math.sin(k / 7)) };
}

/** Bougie 1h agrégée ; `closed` relatif à `reference` (horloge réelle, ou instant rejoué). */
function heure(t0: number, reference = MAINTENANT): Candle {
  const ms = Array.from({ length: 60 }, (_, i) => minute(t0 + i * MIN));
  const volume = ms.reduce((s, m) => s + m.volume, 0);
  const buyVolume = ms.reduce((s, m) => s + (m.buyVolume ?? 0), 0);
  return {
    time: t0,
    open: ms[0]?.open ?? 0,
    close: ms.at(-1)?.close ?? 0,
    high: Math.max(...ms.map((m) => m.high)),
    low: Math.min(...ms.map((m) => m.low)),
    volume,
    buyVolume,
    sellVolume: volume - buyVolume,
    closed: t0 + H1 <= reference,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Footprint monté sur six bougies 1h dont la dernière contient `reference`. */
function monter(symbole: string, reference = MAINTENANT) {
  const fetchFn = vi.fn(async (input: string | URL | Request) => {
    const q = new URL(String(input)).searchParams;
    const lignes: unknown[] = [];
    for (let t = Number(q.get("startTime")); t <= Number(q.get("endTime")) && t <= MAINTENANT; t += MIN) {
      const c = minute(t);
      lignes.push([t, `${c.open}`, `${c.high}`, `${c.low}`, `${c.close}`, `${c.volume}`, t + MIN - 1, "0", 1, `${c.buyVolume}`, "0", "0"]);
    }
    return new Response(JSON.stringify(lignes), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchFn);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("performance", { now: () => 0 });
  vi.stubGlobal("ResizeObserver", class {
    observe(): void {}
    disconnect(): void {}
  });
  vi.stubGlobal("window", { devicePixelRatio: 1, setInterval: () => 0, clearInterval: () => {} });

  const derniere = Math.floor(reference / H1) * H1;
  const bougies = Array.from({ length: 6 }, (_, i) => heure(derniere - (5 - i) * H1, reference));
  const store = {
    getState: () => ({ candles: bougies, exchange: "binance" as ExchangeId, symbol: symbole, timeframe: "1h" }),
  } as unknown as MarketStore;
  const dataList = bougies.map((c) => ({ timestamp: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));

  const textes: string[] = [];
  const ctx = new Proxy({ fillText: (t: string) => textes.push(t) } as Record<string, unknown>, {
    get: (cible, cle) => (cle in cible ? cible[cle as string] : () => {}),
    set: () => true,
  });
  const canvas = { style: {}, width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  const container = { clientWidth: 1200, clientHeight: 800 } as unknown as HTMLElement;
  const chart = {
    subscribeAction: () => {},
    unsubscribeAction: () => {},
    createIndicator: () => null,
    removeIndicator: () => {},
    overrideIndicator: () => {},
    getSize: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
    getVisibleRange: () => ({ from: 0, to: dataList.length }),
    getDataList: () => dataList,
    getBarSpace: () => 120,
    convertToPixel: (p: { timestamp?: number; value?: number }) => ({
      x: p.timestamp !== undefined ? (p.timestamp - (bougies[0]?.time ?? 0)) / 30_000 : 0,
      y: 4_000 - (p.value ?? 0),
    }),
  } as unknown as Chart;

  const ctrl = new OrderflowController(chart, container, canvas, symbole, store);
  const rendre = (): void => (ctrl as unknown as { render: () => void }).render();
  return { ctrl, rendre, textes, fetchFn, bougies };
}

describe("OrderflowController — colonnes historiques intrabar", () => {
  it("passe de « ≈ » à la répartition 1m pour les bougies clôturées, légende comprise", async () => {
    vi.useFakeTimers({ now: MAINTENANT, toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { ctrl, rendre, textes, fetchFn } = monter("ETHUSDT");
    ctrl.setEnabled(true); // premier rendu synchrone (loop)
    textes.length = 0;
    rendre();
    expect(textes.filter((t) => t.startsWith("≈"))).toHaveLength(6); // tout en « ≈ »
    expect(textes.at(-1)).toBe("Colonnes historiques : ≈ réparti sur la bougie (intrabar 1m en chargement)");

    await vi.advanceTimersByTimeAsync(ANTI_REBOND_MS);
    await vi.runAllTimersAsync();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    textes.length = 0;
    rendre();
    // Seule la bougie en cours reste « ≈ » ; les 5 clôturées sont réparties à la minute.
    expect(textes.filter((t) => t.startsWith("≈"))).toHaveLength(1);
    expect(textes.at(-1)).toBe("Colonnes historiques : réparti à la minute (1m) · 5/6");
    ctrl.dispose();
  });

  it("façon replay : données de l'avant-veille, la bougie en cours (drapeau du store) reste « ≈ »", async () => {
    vi.useFakeTimers({ now: MAINTENANT, toFake: ["setTimeout", "clearTimeout", "Date"] });
    // Instant rejoué deux jours avant l'horloge réelle : toutes les bougies sont closes à
    // l'horloge et la dernière retrouve le volume de ses minutes ; seul `closed:false` la protège.
    const { ctrl, rendre, textes, bougies } = monter("LTCUSDT", MAINTENANT - 48 * H1);
    const enCours = bougies.at(-1);
    expect(enCours?.closed).toBe(false);
    expect((enCours?.time ?? Infinity) + H1).toBeLessThan(MAINTENANT);
    ctrl.setEnabled(true);
    rendre();
    await vi.advanceTimersByTimeAsync(ANTI_REBOND_MS);
    await vi.runAllTimersAsync();
    textes.length = 0;
    rendre();
    expect(textes.filter((t) => t.startsWith("≈"))).toHaveLength(1);
    expect(textes.at(-1)).toBe("Colonnes historiques : réparti à la minute (1m) · 5/6");
    ctrl.dispose();
  });
});
