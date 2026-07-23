import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { cvd } from "./cvd";

function c(partial: Partial<Candle> & Pick<Candle, "time" | "close">): Candle {
  return {
    open: partial.close,
    high: partial.close,
    low: partial.close,
    volume: 0,
    ...partial,
  };
}

describe("cvd", () => {
  it("cumule buy − sell", () => {
    const candles = [
      c({ time: 1, close: 10, buyVolume: 5, sellVolume: 2 }),
      c({ time: 2, close: 11, buyVolume: 1, sellVolume: 4 }),
      c({ time: 3, close: 12, buyVolume: 3, sellVolume: 3 }),
    ];
    const { series } = cvd.calc(candles, {}, {
      hl2: [],
      hlc3: [],
      ohlc4: [],
      source: candles.map((x) => x.close),
    });
    expect(series.cvd).toEqual([3, 0, 0]); // 3, 3-3=0, 0+0=0
    expect(series.signal).toEqual([3, 0, 0]); // smooth=1 → même série
  });

  it("ignore les barres sans buy/sell (delta 0)", () => {
    const candles = [c({ time: 1, close: 10, volume: 100 })];
    const { series } = cvd.calc(candles, {}, {
      hl2: [],
      hlc3: [],
      ohlc4: [],
      source: [10],
    });
    expect(series.cvd?.[0]).toBe(0);
  });
});
