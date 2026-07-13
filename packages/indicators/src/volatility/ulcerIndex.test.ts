import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { ulcerIndex } from "./ulcerIndex";

describe("ulcerIndex", () => {
  it("série croissante pure → UI ≈ 0", () => {
    const candles: Candle[] = Array.from({ length: 30 }, (_, i) => ({
      time: i,
      open: 100 + i,
      high: 100 + i,
      low: 100 + i,
      close: 100 + i,
      volume: 1,
    }));
    const { series } = ulcerIndex.calc(
      candles,
      { length: 14 },
      { hl2: [], hlc3: [], ohlc4: [], source: candles.map((c) => c.close) },
    );
    expect(series.ui?.[29]).toBeCloseTo(0, 5);
  });
});
