import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { takerBuyRatio } from "./takerBuyRatio";

function c(partial: Partial<Candle> & Pick<Candle, "time" | "close">): Candle {
  return {
    open: partial.close,
    high: partial.close,
    low: partial.close,
    volume: 0,
    ...partial,
  };
}

describe("takerBuyRatio", () => {
  it("buy / (buy+sell)", () => {
    const candles = [c({ time: 1, close: 1, buyVolume: 75, sellVolume: 25 })];
    const { series } = takerBuyRatio.calc(candles, {}, {
      hl2: [],
      hlc3: [],
      ohlc4: [],
      source: [1],
    });
    expect(series.ratio?.[0]).toBeCloseTo(0.75);
  });

  it("0.5 si volume total nul", () => {
    const candles = [c({ time: 1, close: 1, buyVolume: 0, sellVolume: 0 })];
    const { series } = takerBuyRatio.calc(candles, {}, {
      hl2: [],
      hlc3: [],
      ohlc4: [],
      source: [1],
    });
    expect(series.ratio?.[0]).toBe(0.5);
  });
});
