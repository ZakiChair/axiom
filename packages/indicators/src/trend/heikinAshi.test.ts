import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { heikinAshi } from "./heikinAshi";

describe("heikinAshi", () => {
  it("haHigh ≥ haOpen/haClose ≥ haLow", () => {
    const candles: Candle[] = [
      { time: 0, open: 10, high: 12, low: 9, close: 11, volume: 1 },
      { time: 1, open: 11, high: 13, low: 10, close: 12, volume: 1 },
      { time: 2, open: 12, high: 14, low: 11, close: 13, volume: 1 },
    ];
    const { series } = heikinAshi.calc(candles, {}, {
      hl2: [],
      hlc3: [],
      ohlc4: [],
      source: [11, 12, 13],
    });
    for (let i = 0; i < 3; i++) {
      const o = series.haOpen![i]!;
      const c = series.haClose![i]!;
      const h = series.haHigh![i]!;
      const l = series.haLow![i]!;
      expect(h).toBeGreaterThanOrEqual(Math.max(o, c));
      expect(l).toBeLessThanOrEqual(Math.min(o, c));
    }
  });
});
