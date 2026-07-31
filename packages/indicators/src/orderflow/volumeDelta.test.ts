import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { volumeDelta } from "./volumeDelta";

function c(partial: Partial<Candle> & Pick<Candle, "time" | "close">): Candle {
  return {
    open: partial.close,
    high: partial.close,
    low: partial.close,
    volume: 0,
    ...partial,
  };
}

describe("volumeDelta", () => {
  it("delta par barre", () => {
    const candles = [
      c({ time: 1, close: 1, buyVolume: 10, sellVolume: 4 }),
      c({ time: 2, close: 1, buyVolume: 2, sellVolume: 8 }),
    ];
    const { series } = volumeDelta.calc(candles, {}, {
      hl2: [],
      hlc3: [],
      ohlc4: [],
      source: [1, 1],
    });
    expect(series.delta).toEqual([6, -6]);
  });

  it("undefined sans split", () => {
    const candles = [c({ time: 1, close: 1, volume: 9 })];
    const { series } = volumeDelta.calc(candles, {}, {
      hl2: [],
      hlc3: [],
      ohlc4: [],
      source: [1],
    });
    expect(series.delta?.[0]).toBeUndefined();
  });
});
