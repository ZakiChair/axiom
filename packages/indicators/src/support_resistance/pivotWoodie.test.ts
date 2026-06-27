/**
 * @axiom/indicators — support_resistance/pivotWoodie.test.ts
 *
 * Valeurs ATTENDUES hand-calc depuis la BOUGIE PRÉCÉDENTE H=12, L=8, C=11 :
 *   PP = (H + L + 2·C)/4 = (12 + 8 + 22)/4 = 42/4 = 10.5
 *   R1 = 2·PP − L = 21 − 8 = 13
 *   S1 = 2·PP − H = 21 − 12 = 9
 *   R2 = PP + (H − L) = 10.5 + 4 = 14.5
 *   S2 = PP − (H − L) = 10.5 − 4 = 6.5
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { pivotWoodie } from "./pivotWoodie";

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

describe("Pivot Points Woodie", () => {
  it("calcule PP=(H+L+2C)/4 et R1/S1/R2/S2 (hand-calc)", () => {
    const cs = candles([
      { o: 9, h: 12, l: 8, c: 11 },
      { o: 11, h: 13, l: 10, c: 12 },
    ]);
    const { series } = computeIndicator(pivotWoodie, cs, {});

    for (const key of ["pp", "r1", "s1", "r2", "s2"]) {
      const s = series[key];
      if (s === undefined) throw new Error(`série ${key} absente`);
      expect(s.length).toBe(cs.length);
      expect(s[0]).toBeUndefined();
    }

    expect(series.pp![1]).toBeCloseTo(10.5, 9);
    expect(series.r1![1]).toBeCloseTo(13, 9);
    expect(series.s1![1]).toBeCloseTo(9, 9);
    expect(series.r2![1]).toBeCloseTo(14.5, 9);
    expect(series.s2![1]).toBeCloseTo(6.5, 9);

    // Invariant d'ordre S2 ≤ S1 ≤ PP ≤ R1 ≤ R2.
    const ordered = [series.s2![1], series.s1![1], series.pp![1], series.r1![1], series.r2![1]];
    for (let k = 1; k < ordered.length; k++) {
      expect(ordered[k]! >= ordered[k - 1]!).toBe(true);
    }
  });
});
