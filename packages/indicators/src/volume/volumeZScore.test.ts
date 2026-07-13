import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { volumeZScore } from "./volumeZScore";

describe("volumeZScore", () => {
  it("série plate → z ≈ 0", () => {
    const candles: Candle[] = Array.from({ length: 30 }, (_, i) => ({
      time: i,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 50,
    }));
    const { series } = volumeZScore.calc(
      candles,
      { length: 20 },
      { hl2: [], hlc3: [], ohlc4: [], source: candles.map((c) => c.close) },
    );
    expect(series.z?.[29]).toBeCloseTo(0, 6);
  });
});
