/**
 * @axiom/indicators — support_resistance/pivotStandard.test.ts
 *
 * Valeurs ATTENDUES calculées à la main depuis la BOUGIE PRÉCÉDENTE
 * H=12, L=8, C=11 (indicateur linéaire simple -> précision exacte) :
 *
 *   PP = (12 + 8 + 11) / 3 = 31/3 = 10.333333…
 *   R1 = 2·PP − L = 62/3 − 8 = 38/3 = 12.666667…
 *   S1 = 2·PP − H = 62/3 − 12 = 26/3 = 8.666667…
 *   R2 = PP + (H − L) = 31/3 + 4 = 43/3 = 14.333333…
 *   S2 = PP − (H − L) = 31/3 − 4 = 19/3 = 6.333333…
 *   R3 = H + 2·(PP − L) = 12 + 14/3 = 50/3 = 16.666667…
 *   S3 = L − 2·(H − PP) = 8 − 10/3 = 14/3 = 4.666667…
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { pivotStandard } from "./pivotStandard";

interface OHLC {
  o: number;
  h: number;
  l: number;
  c: number;
}

function candles(rows: OHLC[]): Candle[] {
  return rows.map((r, i) => ({
    time: i * 60_000,
    open: r.o,
    high: r.h,
    low: r.l,
    close: r.c,
    volume: 0,
  }));
}

describe("Pivot Points Standard", () => {
  it("calcule les niveaux depuis la bougie précédente (valeurs hand-calc)", () => {
    const cs = candles([
      { o: 9, h: 12, l: 8, c: 11 }, // bougie 0 -> alimente l'index 1
      { o: 11, h: 13, l: 10, c: 12 },
      { o: 12, h: 14, l: 11, c: 13 },
    ]);
    const { series } = computeIndicator(pivotStandard, cs, {});

    for (const key of ["pp", "r1", "s1", "r2", "s2", "r3", "s3"]) {
      const s = series[key];
      if (s === undefined) throw new Error(`série ${key} absente`);
      expect(s.length).toBe(cs.length); // (a) longueur alignée
      expect(s[0]).toBeUndefined(); // (a) bougie 0 sans précédente
    }

    const pp = series.pp!;
    const r1 = series.r1!;
    const s1 = series.s1!;
    const r2 = series.r2!;
    const s2 = series.s2!;
    const r3 = series.r3!;
    const s3 = series.s3!;

    expect(pp[1]).toBeCloseTo(10.3333333333, 9);
    expect(r1[1]).toBeCloseTo(12.6666666667, 9);
    expect(s1[1]).toBeCloseTo(8.6666666667, 9);
    expect(r2[1]).toBeCloseTo(14.3333333333, 9);
    expect(s2[1]).toBeCloseTo(6.3333333333, 9);
    expect(r3[1]).toBeCloseTo(16.6666666667, 9);
    expect(s3[1]).toBeCloseTo(4.6666666667, 9);

    // (b) invariant d'ordre S3 ≤ S2 ≤ S1 ≤ PP ≤ R1 ≤ R2 ≤ R3 à chaque bougie.
    for (let i = 1; i < cs.length; i++) {
      const a = [s3[i], s2[i], s1[i], pp[i], r1[i], r2[i], r3[i]];
      for (const v of a) expect(v).toBeDefined();
      for (let k = 1; k < a.length; k++) {
        expect(a[k]! >= a[k - 1]!).toBe(true);
      }
    }
  });
});
