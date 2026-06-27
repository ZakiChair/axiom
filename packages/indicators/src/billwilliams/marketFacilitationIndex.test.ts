/**
 * @axiom/indicators — billwilliams/marketFacilitationIndex.test.ts
 *
 * MFI = (high - low) / volume. Indicateur simple et linéaire : valeurs EXACTES.
 *
 * Bougies (h, l, vol) :
 *   i=0 : (12, 10, 2)   -> (12-10)/2 = 1
 *   i=1 : (15, 10, 5)   -> (15-10)/5 = 1
 *   i=2 : (20, 14, 3)   -> (20-14)/3 = 2
 *   i=3 : (11, 11, 4)   -> (11-11)/4 = 0   (range nul mais volume non nul)
 *   i=4 : (18, 12, 0)   -> volume nul -> undefined
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { marketFacilitationIndex } from "./marketFacilitationIndex";

function hlvCandles(rows: Array<[h: number, l: number, vol: number]>): Candle[] {
  return rows.map(([h, l, vol], i) => {
    const mid = (h + l) / 2;
    return {
      time: i * 60_000,
      open: mid,
      high: h,
      low: l,
      close: mid,
      volume: vol,
    };
  });
}

describe("Market Facilitation Index (Bill Williams)", () => {
  it("calcule (h-l)/vol exactement et laisse undefined si volume nul", () => {
    const candles = hlvCandles([
      [12, 10, 2],
      [15, 10, 5],
      [20, 14, 3],
      [11, 11, 4],
      [18, 12, 0],
    ]);
    const { series } = computeIndicator(marketFacilitationIndex, candles);
    const mfi = series.mfi;
    if (mfi === undefined) throw new Error("série mfi absente");

    expect(mfi.length).toBe(candles.length);
    expect(mfi[0]).toBeCloseTo(1, 12);
    expect(mfi[1]).toBeCloseTo(1, 12);
    expect(mfi[2]).toBeCloseTo(2, 12);
    expect(mfi[3]).toBeCloseTo(0, 12);
    expect(mfi[4]).toBeUndefined();

    // Invariant : toujours >= 0.
    for (const v of mfi) {
      if (v !== undefined) expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});
