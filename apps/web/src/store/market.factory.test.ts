/**
 * Tests de la fabrique de store marché (Phase 4 multi-chart) : chaque instance créée
 * par `createMarketStore` est ISOLÉE — buffer, symbole, TF et source indépendants —
 * et l'instance globale `marketStore` reste une instance à part entière.
 */
import { describe, expect, it } from "vitest";
import { createMarketStore, marketStore } from "./market";
import type { Candle } from "@axiom/types";

const candle = (time: number, close: number): Candle => ({
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
});

describe("createMarketStore", () => {
  it("crée des instances aux buffers indépendants", () => {
    const a = createMarketStore();
    const b = createMarketStore();

    a.getState().upsertCandle(candle(1000, 10));
    a.getState().upsertCandle(candle(2000, 11));

    expect(a.getState().candles).toHaveLength(2);
    expect(b.getState().candles).toHaveLength(0); // b n'est pas affecté
  });

  it("isole symbole / TF / source entre instances", () => {
    const a = createMarketStore({ symbol: "ethusdt", timeframe: "5m", exchange: "kraken" });
    const b = createMarketStore();

    expect(a.getState().symbol).toBe("ETHUSDT"); // normalisé en majuscules
    expect(a.getState().timeframe).toBe("5m");
    expect(a.getState().exchange).toBe("kraken");

    a.getState().setSymbol("solusdt");
    expect(a.getState().symbol).toBe("SOLUSDT");
    expect(b.getState().symbol).toBe("BTCUSDT"); // défaut, inchangé
  });

  it("préserve la casse des sources dans les symboles synthétiques", () => {
    const store = createMarketStore({ exchange: "synthetic", symbol: "binance:ETHUSDT|/|twelvedata:GLD" });
    expect(store.getState().symbol).toBe("binance:ETHUSDT|/|twelvedata:GLD");

    store.getState().setSymbol("binance:BTCUSDT|/|twelvedata:UUP");
    expect(store.getState().symbol).toBe("binance:BTCUSDT|/|twelvedata:UUP");
  });

  it("marketStore global est une instance isolée des fabriquées", () => {
    const local = createMarketStore();
    local.getState().setSymbol("DOGEUSDT");
    expect(marketStore.getState().symbol).not.toBe("DOGEUSDT");
  });
});
