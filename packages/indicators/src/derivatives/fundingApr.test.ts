import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { fundingApr } from "./fundingApr";

describe("fundingApr", () => {
  it("annualise un funding 8h : 0.01% → ~10.95% APR", () => {
    // rate = 0.0001 = 0.01% par 8h → ×3×365×100 = 10.95
    const candles: Candle[] = Array.from({ length: 3 }, (_, i) => ({
      time: i,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 1,
    }));
    const funding = [0.0001, 0.0001, 0.0001];
    const { series } = fundingApr.calc(
      candles,
      { intervalH: 8 },
      { hl2: [], hlc3: [], ohlc4: [], source: [1, 1, 1], aux: { funding } },
    );
    expect(series.apr?.[2]).toBeCloseTo(0.0001 * 3 * 365 * 100, 5);
  });

  it("sans aux → tout undefined", () => {
    const candles: Candle[] = [
      { time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ];
    const { series } = fundingApr.calc(
      candles,
      { intervalH: 8 },
      { hl2: [], hlc3: [], ohlc4: [], source: [1] },
    );
    expect(series.apr?.[0]).toBeUndefined();
  });
});
