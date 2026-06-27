/**
 * @axiom/indicators — support_resistance/pivotCamarilla.test.ts
 *
 * Valeurs ATTENDUES hand-calc depuis la BOUGIE PRÉCÉDENTE H=12, L=8, C=11 :
 *   range = 4
 *   H1 = C + range·1.1/12 = 11 + 4·0.0916667 = 11 + 0.366667 = 11.366667…
 *   H2 = C + range·1.1/6  = 11 + 0.733333 = 11.733333…
 *   H3 = C + range·1.1/4  = 11 + 1.1 = 12.1
 *   H4 = C + range·1.1/2  = 11 + 2.2 = 13.2
 *   L1 = C − range·1.1/12 = 10.633333…
 *   L2 = C − range·1.1/6  = 10.266667…
 *   L3 = C − range·1.1/4  = 9.9
 *   L4 = C − range·1.1/2  = 8.8
 *   PP = (12 + 8 + 11)/3 = 10.333333…
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { pivotCamarilla } from "./pivotCamarilla";

function candles(rows: { o: number; h: number; l: number; c: number }[]): Candle[] {
  return rows.map((r, i) => ({
    time: i * 60_000,
    open: r.o,
    high: r.h,
    low: r.l,
    close: r.c,
    volume: 0,
  }));
}

describe("Pivot Points Camarilla", () => {
  it("calcule H1-4 / L1-4 depuis la bougie précédente (hand-calc)", () => {
    const cs = candles([
      { o: 9, h: 12, l: 8, c: 11 },
      { o: 11, h: 13, l: 10, c: 12 },
    ]);
    const { series } = computeIndicator(pivotCamarilla, cs, {});

    for (const key of ["pp", "h1", "h2", "h3", "h4", "l1", "l2", "l3", "l4"]) {
      const s = series[key];
      if (s === undefined) throw new Error(`série ${key} absente`);
      expect(s.length).toBe(cs.length);
      expect(s[0]).toBeUndefined();
    }

    expect(series.h1![1]).toBeCloseTo(11.3666666667, 9);
    expect(series.h2![1]).toBeCloseTo(11.7333333333, 9);
    expect(series.h3![1]).toBeCloseTo(12.1, 9);
    expect(series.h4![1]).toBeCloseTo(13.2, 9);
    expect(series.l1![1]).toBeCloseTo(10.6333333333, 9);
    expect(series.l2![1]).toBeCloseTo(10.2666666667, 9);
    expect(series.l3![1]).toBeCloseTo(9.9, 9);
    expect(series.l4![1]).toBeCloseTo(8.8, 9);
    expect(series.pp![1]).toBeCloseTo(10.3333333333, 9);

    // Invariant : H1 < H2 < H3 < H4 et L1 > L2 > L3 > L4.
    expect(series.h1![1]! < series.h2![1]!).toBe(true);
    expect(series.h2![1]! < series.h3![1]!).toBe(true);
    expect(series.h3![1]! < series.h4![1]!).toBe(true);
    expect(series.l1![1]! > series.l2![1]!).toBe(true);
    expect(series.l2![1]! > series.l3![1]!).toBe(true);
    expect(series.l3![1]! > series.l4![1]!).toBe(true);
  });
});
