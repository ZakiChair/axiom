import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { kyleLambda } from "./kyleLambda";

function ctxDe(candles: Candle[]) {
  return { hl2: [], hlc3: [], ohlc4: [], source: candles.map((c) => c.close) };
}

describe("kyleLambda", () => {
  it("r = ±0,001 exactement porté par q = ±0,5 : λ = 10⁴·0,002 = 20 pb", () => {
    // Clôtures : c_i = c_{i−1}·e^{±0,001} ; split taker ±0,5 en phase avec le rendement.
    const candles: Candle[] = [];
    let close = 100;
    for (let i = 0; i < 25; i++) {
      if (i > 0) close = i % 2 === 1 ? close * Math.exp(0.001) : close * Math.exp(-0.001);
      const haussier = i % 2 === 1;
      const buy = haussier ? 0.75 : 0.25;
      const sell = haussier ? 0.25 : 0.75;
      candles.push({ time: i, open: close, high: close, low: close, close, volume: 1, buyVolume: buy, sellVolume: sell });
    }
    const { series } = kyleLambda.calc(candles, { length: 20 }, ctxDe(candles));
    // cov(r,q)/var(q) = 0,0005 / 0,25 = 0,002 → 20 pb par unité de déséquilibre.
    expect(series.lambda?.[20]).toBeCloseTo(20, 6);
  });

  it("déséquilibre constant : var(q) = 0 → λ non défini", () => {
    const candles: Candle[] = Array.from({ length: 30 }, (_, i) => ({
      time: i,
      open: 100 + i,
      high: 100 + i,
      low: 100 + i,
      close: 100 + i,
      volume: 1,
      buyVolume: 0.8,
      sellVolume: 0.2,
    }));
    const { series } = kyleLambda.calc(candles, { length: 20 }, ctxDe(candles));
    expect(series.lambda?.[25]).toBeUndefined();
  });

  it("split taker absent : λ non défini (indicateur Binance)", () => {
    const candles: Candle[] = Array.from({ length: 30 }, (_, i) => ({
      time: i,
      open: 100 + i,
      high: 100 + i,
      low: 100 + i,
      close: 100 + i,
      volume: 1,
    }));
    const { series } = kyleLambda.calc(candles, { length: 20 }, ctxDe(candles));
    expect(series.lambda?.[25]).toBeUndefined();
  });
});
