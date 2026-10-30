/**
 * Identité d'avant le correctif {twelvedata, USDT.D} rejouée par les chemins de restauration qui
 * posent la source EXPLICITEMENT (lot fuites-séries-synthétiques, revue du 30/10) : workspace
 * enregistré puis appliqué (store/workspaces.ts), message d'une autre fenêtre (store/sync.ts). Tous
 * deux passent par `setMarket`, qui résout le couple. Le bandeau s'abonne au ticker avec l'identité
 * du store (SymbolBanner) : sur {twelvedata, USDT.D}, /quote partait chez Twelve Data en séance.
 *
 * Mocks : ceux de workspaces.test.ts (priceScaleStore, thème) et de quoi charger le bandeau hors
 * navigateur (klinecharts, outils de dessin).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExchangeId } from "@axiom/types";

vi.mock("../chart/Chart", async () => {
  const { createStore } = await import("zustand/vanilla");
  const priceScaleStore = createStore<{ type: string; setType: (t: string) => void }>((set) => ({
    type: "normal",
    setType: (type) => set({ type }),
  }));
  return { priceScaleStore };
});
vi.mock("./theme", () => ({
  THEMES: ["dark", "bloomberg", "matrix", "cute", "aurora"],
  themeStore: { getState: () => ({ theme: "dark", setTheme: () => {} }), subscribe: () => () => {} },
}));
vi.mock("../chart/drawing", () => ({ exportChartImage: () => {}, clearAllOverlays: () => {}, getActiveChart: () => null }));
vi.mock("klinecharts", () => ({ ActionType: {}, DomPosition: {}, registerOverlay: () => {} }));

import { marketStore } from "./market";
import { DEFAULT_WORKSPACE_ID, workspacesStore, type WorkspaceContent } from "./workspaces";
import { demarrerSyncFenetres } from "./sync";
import { subscribeSymbolBannerTicker } from "../components/SymbolBanner";

/** Jeudi 11 h à New York : le ticker Twelve Data ne sonde qu'en séance. */
const SEANCE_NYSE = new Date("2026-10-29T15:00:00Z");

function contenu(exchange: ExchangeId, symbol: string): WorkspaceContent {
  return {
    exchange, symbol, timeframe: "1h", indicators: [], orderflow: false, volumeProfile: false, revenue: false,
    compare: [], macroOverlays: [], theme: "dark", sections: {}, priceScale: "normal", windowGeometry: {},
  };
}

/** Requêtes Twelve Data du bandeau abonné 2 s à l'identité COURANTE du store. */
async function requetesTwelveDataDuBandeau(): Promise<string[]> {
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    urls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return new Response("{}", { status: 503 });
  }));
  vi.useFakeTimers({ now: SEANCE_NYSE, toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  const { exchange, symbol } = marketStore.getState();
  const stop = subscribeSymbolBannerTicker(exchange, symbol, () => {});
  await vi.advanceTimersByTimeAsync(2_000);
  stop();
  return urls.filter((url) => url.includes("tdapi") || url.includes("twelvedata"));
}

function identite() {
  const { exchange, symbol, timeframe } = marketStore.getState();
  return { exchange, symbol, timeframe };
}

beforeEach(() => {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
    key: (i) => Array.from(data.keys())[i] ?? null,
    get length() { return data.size; },
  };
  marketStore.setState({ exchange: "binance", symbol: "BTCUSDT", timeframe: "1h", candles: [] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("identité {twelvedata, USDT.D} restaurée à source explicite : la série, sans Twelve Data", () => {
  it("témoin du capteur : l'identité brute posée sans setMarket sonde bien /quote", async () => {
    marketStore.setState({ exchange: "twelvedata", symbol: "USDT.D" });
    expect((await requetesTwelveDataDuBandeau()).some((url) => url.includes("quote?symbol=USDT.D"))).toBe(true);
  });

  it.each(["USDT.D", "usdt.d", "USDT.D+USDC.D+DAI.D", "DAI.D"])("workspace enregistré avant le correctif {twelvedata, %j} puis appliqué", async (symbol) => {
    workspacesStore.setState({
      workspaces: [
        { id: DEFAULT_WORKSPACE_ID, name: "Défaut", content: contenu("binance", "BTCUSDT") },
        { id: "ancien", name: "Ancien", content: contenu("twelvedata", symbol) },
      ],
      currentId: DEFAULT_WORKSPACE_ID,
    });
    workspacesStore.getState().apply("ancien");
    expect(identite()).toEqual({ exchange: "synthetic", symbol: "STABLE.D", timeframe: "1h" });
    expect(await requetesTwelveDataDuBandeau()).toEqual([]);
  });

  it("message d'une autre fenêtre {twelvedata, USDT.D} (onglet resté sur l'ancien code)", async () => {
    let canal: { onmessage: ((event: MessageEvent) => void) | null } | undefined;
    vi.stubGlobal("BroadcastChannel", class {
      onmessage: ((event: MessageEvent) => void) | null = null;
      postMessage = vi.fn();
      close() {}
      constructor() { canal = this; }
    });
    const stopSync = demarrerSyncFenetres();
    try {
      canal?.onmessage?.({ data: { kind: "symbol", sender: "autre-fenetre", exchange: "twelvedata", symbol: "USDT.D" } } as MessageEvent);
    } finally {
      stopSync();
    }
    expect(identite()).toEqual({ exchange: "synthetic", symbol: "STABLE.D", timeframe: "1h" });
    expect(await requetesTwelveDataDuBandeau()).toEqual([]);
  });
});
