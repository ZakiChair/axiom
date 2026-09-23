/** Écart HL − Binance : deux taux horaires observés, jambe absente → undefined. */
import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { fundingSpreadHl } from "./fundingSpreadHl";

const candles = (n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => ({ time: i, open: 1, high: 1, low: 1, close: 1, volume: 1 }));

describe("fundingSpreadHl", () => {
  it("spread = (hl horaire − Binance horaire) × 24 × 365 × 100", () => {
    const r = fundingSpreadHl.calc(candles(3), {}, {
      hl2: [], hlc3: [], ohlc4: [], source: [],
      aux: {
        hlFunding: [0.00002, 0.00002, 0.00002],
        binanceFundingHourly: [0.00001, undefined, Number.NaN],
        funding: [0.8, 0.8, 0.8],
      },
    });
    expect(fundingSpreadHl.aux).toEqual(["hlFunding", "binanceFundingHourly"]);
    expect(r.series.spread?.[0]).toBeCloseTo(8.76, 8);
    expect(r.series.spread?.slice(1)).toEqual([undefined, undefined]);
  });
  it("aux absent → all-undefined", () => {
    const r = fundingSpreadHl.calc(candles(2), {}, { hl2: [], hlc3: [], ohlc4: [], source: [] });
    expect(r.series.spread).toEqual([undefined, undefined]);
  });
});
