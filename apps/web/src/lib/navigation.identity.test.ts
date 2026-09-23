import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("klinecharts", () => ({ registerOverlay: () => {} }));
vi.mock("../chart/drawing", () => ({ getActiveChart: () => null, setFocusChart: () => {} }));

import { chartLayoutStore } from "../store/chart-layout";
import { marketStore } from "../store/market";
import { navigateTo } from "./navigation";

beforeEach(() => {
  marketStore.setState({ exchange: "binance", symbol: "ETHUSDT", timeframe: "1m", candles: [] });
  chartLayoutStore.getState().setLayout("2h");
  chartLayoutStore.getState().setSlotMarket(1, { exchange: "binance", symbol: "ETHUSDT", timeframe: "1m" });
  chartLayoutStore.getState().setFocus(0);
});

describe("navigation d’une identité historique", () => {
  it("conserve le perp HL historique au lieu de le réinterpréter spot", () => {
    const identites: unknown[] = [];
    const stop = marketStore.subscribe((s) => identites.push({ exchange: s.exchange, symbol: s.symbol, timeframe: s.timeframe }));
    try {
      navigateTo({ source: "note", exchange: "hyperliquid", symbol: "BTCUSDT", timeframe: "4h" });
      expect(identites).toEqual([{ exchange: "hyperliquid", symbol: "BTCUSDT", timeframe: "4h" }]);
    } finally {
      stop();
    }
  });

  it("applique l’identité complète au slot secondaire focalisé", () => {
    chartLayoutStore.getState().setFocus(1);
    navigateTo({ source: "note", exchange: "hyperliquid", symbol: "BTCUSDT", timeframe: "4h" });
    expect(chartLayoutStore.getState().slots[0]).toEqual({ exchange: "hyperliquid", symbol: "BTCUSDT", timeframe: "4h" });
    expect(marketStore.getState()).toMatchObject({ exchange: "binance", symbol: "ETHUSDT", timeframe: "1m" });
  });

  it("un symbole seul conserve le routage automatique", () => {
    marketStore.setState({ exchange: "hyperliquid", symbol: "BTC-PERP" });
    navigateTo({ source: "news", symbol: "ETHUSDT" });
    expect(marketStore.getState()).toMatchObject({ exchange: "binance", symbol: "ETHUSDT" });
  });
});
