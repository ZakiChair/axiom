import { describe, expect, it } from "vitest";
import { createMarketStore } from "./market";

describe("nouvel actif, source automatique cohérente", () => {
  it("quitte TradFi pour une paire crypto et reconnaît une action", () => {
    const store = createMarketStore({ exchange: "twelvedata", symbol: "AAPL" });
    store.getState().setSymbol("BTCUSDT");
    expect(store.getState().exchange).toBe("binance");
    store.getState().setSymbol("SPY");
    expect(store.getState().exchange).toBe("twelvedata");
  });
  it("ne transforme jamais un choix spot en perp parce que le précédent était HL", () => {
    const store = createMarketStore({ exchange: "hyperliquid", symbol: "BTCUSDT" });
    store.getState().setSymbol("ETHUSDT");
    expect(store.getState().exchange).toBe("binance");
    store.getState().setSymbol("ETH-PERP");
    expect(store.getState().exchange).toBe("hyperliquid");
  });
});

it("quitter une jambe TradFi synthétique pour du spot ne conserve pas TradFi", () => {
  const store = createMarketStore({ exchange: "synthetic", symbol: "twelvedata:SPY|/|twelvedata:GLD" });
  store.getState().setSymbol("BTCUSDT");
  expect(store.getState().exchange).toBe("binance");
});
