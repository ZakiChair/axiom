import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { relativeVolume } from "./relativeVolume";

function bars(vols: number[]): Candle[] {
  return vols.map((volume, i) => ({
    time: i,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume,
  }));
}

describe("relativeVolume", () => {
  it("volume / sma = 1 sur série plate", () => {
    const candles = bars(Array(25).fill(100) as number[]);
    const { series } = relativeVolume.calc(
      candles,
      { length: 20 },
      { hl2: [], hlc3: [], ohlc4: [], source: candles.map((c) => c.close) },
    );
    expect(series.rvol?.[24]).toBeCloseTo(1, 6);
  });
});
