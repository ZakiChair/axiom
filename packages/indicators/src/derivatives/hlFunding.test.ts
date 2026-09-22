/** Funding HL : annualisation horaire × 24 × 365 × 100, garde aux. */
import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { hlFunding } from "./hlFunding";

const candles = (n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => ({ time: i, open: 1, high: 1, low: 1, close: 1, volume: 1 }));

describe("hlFunding", () => {
  it("APR % = taux horaire × 876 000 ; trous préservés", () => {
    const r = hlFunding.calc(candles(3), {}, {
      hl2: [], hlc3: [], ohlc4: [], source: [],
      aux: { hlFunding: [0.00002, undefined, -0.00001] },
    });
    expect(r.series.apr?.[0]).toBeCloseTo(17.52, 2); // +17,5 % APR
    expect(r.series.apr?.[1]).toBeUndefined();
    expect(r.series.apr?.[2]).toBeCloseTo(-8.76, 2);
  });
  it("aux absent → all-undefined", () => {
    const r = hlFunding.calc(candles(2), {}, { hl2: [], hlc3: [], ohlc4: [], source: [] });
    expect(r.series.apr).toEqual([undefined, undefined]);
  });
});
