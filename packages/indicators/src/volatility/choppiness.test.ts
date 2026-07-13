import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { choppiness } from "./choppiness";

describe("choppiness", () => {
  it("marché en range étroit → CHOP élevé", () => {
    const candles: Candle[] = Array.from({ length: 30 }, (_, i) => ({
      time: i,
      open: 100,
      high: 100.5,
      low: 99.5,
      close: 100 + (i % 2 === 0 ? 0.2 : -0.2),
      volume: 1,
    }));
    const { series } = choppiness.calc(
      candles,
      { length: 14 },
      { hl2: [], hlc3: [], ohlc4: [], source: candles.map((c) => c.close) },
    );
    const chop = series.chop?.[29];
    expect(chop).toBeDefined();
    expect(chop!).toBeGreaterThan(50);
  });
});
