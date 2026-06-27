/**
 * @axiom/indicators — support_resistance/pivotFibonacci.test.ts
 *
 * Valeurs ATTENDUES hand-calc depuis la BOUGIE PRÉCÉDENTE H=12, L=8, C=11 :
 *   PP    = 31/3 = 10.333333…
 *   range = 4
 *   R1 = PP + 0.382·4 = 10.333333 + 1.528 = 11.861333…
 *   S1 = PP − 0.382·4 = 8.805333…
 *   R2 = PP + 0.618·4 = 10.333333 + 2.472 = 12.805333…
 *   S2 = PP − 0.618·4 = 7.861333…
 *   R3 = PP + 1.000·4 = 14.333333…
 *   S3 = PP − 1.000·4 = 6.333333…
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { pivotFibonacci } from "./pivotFibonacci";

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

describe("Pivot Points Fibonacci", () => {
  it("calcule PP ± fib·range depuis la bougie précédente (hand-calc)", () => {
    const cs = candles([
      { o: 9, h: 12, l: 8, c: 11 },
      { o: 11, h: 13, l: 10, c: 12 },
    ]);
    const { series } = computeIndicator(pivotFibonacci, cs, {});

    for (const key of ["pp", "r1", "s1", "r2", "s2", "r3", "s3"]) {
      const s = series[key];
      if (s === undefined) throw new Error(`série ${key} absente`);
      expect(s.length).toBe(cs.length);
      expect(s[0]).toBeUndefined();
    }

    expect(series.pp![1]).toBeCloseTo(10.3333333333, 9);
    expect(series.r1![1]).toBeCloseTo(11.8613333333, 9);
    expect(series.s1![1]).toBeCloseTo(8.8053333333, 9);
    expect(series.r2![1]).toBeCloseTo(12.8053333333, 9);
    expect(series.s2![1]).toBeCloseTo(7.8613333333, 9);
    expect(series.r3![1]).toBeCloseTo(14.3333333333, 9);
    expect(series.s3![1]).toBeCloseTo(6.3333333333, 9);

    // Invariant d'ordre S3 ≤ S2 ≤ S1 ≤ PP ≤ R1 ≤ R2 ≤ R3.
    const ordered = [
      series.s3![1],
      series.s2![1],
      series.s1![1],
      series.pp![1],
      series.r1![1],
      series.r2![1],
      series.r3![1],
    ];
    for (let k = 1; k < ordered.length; k++) {
      expect(ordered[k]! >= ordered[k - 1]!).toBe(true);
    }
  });
});
