import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { randomWalk } from "./randomWalk";

describe("randomWalk", () => {
  it("produit RWI high/low après amorçage", () => {
    const candles: Candle[] = Array.from({ length: 40 }, (_, i) => ({
      time: i,
      open: 100 + i,
      high: 102 + i,
      low: 98 + i,
      close: 101 + i,
      volume: 1,
    }));
    const { series } = randomWalk.calc(
      candles,
      { length: 14 },
      { hl2: [], hlc3: [], ohlc4: [], source: candles.map((c) => c.close) },
    );
    expect(series.high?.[39]).toBeDefined();
    expect(series.low?.[39]).toBeDefined();
    expect(series.high![39]!).toBeGreaterThan(0);
  });
});
