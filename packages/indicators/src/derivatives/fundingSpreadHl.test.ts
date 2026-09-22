/** Écart HL − Binance : conventions horaire vs 8 h, jambe absente → undefined. */
import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { fundingSpreadHl } from "./fundingSpreadHl";

const candles = (n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => ({ time: i, open: 1, high: 1, low: 1, close: 1, volume: 1 }));

describe("fundingSpreadHl", () => {
  it("spread = (hl×24 − binance×3) × 365 × 100", () => {
    // Taux égaux horaire vs 8 h : hl=0.00001/h, bn=0.00003/8h → même coût → spread ~0 ?
    // 0.00001×24 = 0.00024 ; 0.00003×3 = 0.00009 → spread = 0.00015×365×100 = 5.475.
    const r = fundingSpreadHl.calc(candles(2), {}, {
      hl2: [], hlc3: [], ohlc4: [], source: [],
      aux: { hlFunding: [0.00001, 0.00001], funding: [0.00003, undefined] },
    });
    expect(r.series.spread?.[0]).toBeCloseTo(5.475, 3);
    expect(r.series.spread?.[1]).toBeUndefined(); // jambe binance absente
  });
  it("aux absent → all-undefined", () => {
    const r = fundingSpreadHl.calc(candles(2), {}, { hl2: [], hlc3: [], ohlc4: [], source: [] });
    expect(r.series.spread).toEqual([undefined, undefined]);
  });
});
