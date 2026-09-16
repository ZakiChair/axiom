import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { corwinSchultz } from "./corwinSchultz";

function ctxDe(candles: Candle[]) {
  return { hl2: [], hlc3: [], ohlc4: [], source: candles.map((c) => c.close) };
}

describe("corwinSchultz", () => {
  it("range constant H=102/L=98 : S = 2·(H/L−1)/(1+H/L) = 4,0000 % (α = ln(H/L))", () => {
    const candles: Candle[] = Array.from({ length: 30 }, (_, i) => ({
      time: i,
      open: 100,
      high: 102,
      low: 98,
      close: 100,
      volume: 1,
    }));
    const { series } = corwinSchultz.calc(candles, { length: 20 }, ctxDe(candles));
    expect(series.spread?.[18]).toBeUndefined(); // 19 paires nécessaires
    expect(series.spread?.[19]).toBeCloseTo(4.0, 6);
  });

  it("deux barres disjointes (mouvement, pas de spread) : S borné à 0", () => {
    const candles: Candle[] = [
      { time: 0, open: 100.5, high: 101, low: 100, close: 100.5, volume: 1 },
      { time: 1, open: 110.5, high: 111, low: 110, close: 110.5, volume: 1 },
    ];
    const { series } = corwinSchultz.calc(candles, { length: 2 }, ctxDe(candles));
    expect(series.spread?.[1]).toBe(0);
  });
});
