/**
 * @axiom/indicators — momentum/stochastic.test.ts
 *
 * Stochastic : %K hand-calc + %D vérifié + invariant de borne [0, 100].
 *
 * Bougies (high, low, close), kLength = 3, dLength = 2 :
 *   i0: h=10 l=8  c=9
 *   i1: h=12 l=9  c=11
 *   i2: h=11 l=7  c=8
 *   i3: h=13 l=10 c=12
 *
 *   %K[i2] = 100*(8-7)/(12-7)  = 20
 *   %K[i3] = 100*(12-7)/(13-7) = 83.33333...
 *   %D[i3] = SMA(%K, 2) = (20 + 83.33333...) / 2 = 51.66666...
 *   %K index 0,1 : undefined ; %D index 0,1,2 : undefined.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { stochastic } from "./stochastic";

type HLC = [high: number, low: number, close: number];

function candlesFromHLC(rows: HLC[]): Candle[] {
  return rows.map(([high, low, close], i) => ({
    time: i * 60_000,
    open: close,
    high,
    low,
    close,
    volume: 0,
  }));
}

describe("Stochastic", () => {
  it("calcule %K hand-calc, %D lissé, et amorce undefined", () => {
    const candles = candlesFromHLC([
      [10, 8, 9],
      [12, 9, 11],
      [11, 7, 8],
      [13, 10, 12],
    ]);
    const { series } = computeIndicator(stochastic, candles, {
      kLength: 3,
      dLength: 2,
    });
    const k = series.k;
    const d = series.d;
    if (k === undefined || d === undefined) throw new Error("séries stoch absentes");

    expect(k.length).toBe(candles.length);
    expect(k[0]).toBeUndefined();
    expect(k[1]).toBeUndefined();
    expect(k[2]).toBeCloseTo(20, 12);
    expect(k[3]).toBeCloseTo((100 * 5) / 6, 12);

    expect(d[0]).toBeUndefined();
    expect(d[1]).toBeUndefined();
    expect(d[2]).toBeUndefined();
    expect(d[3]).toBeCloseTo((20 + (100 * 5) / 6) / 2, 12);
  });

  it("respecte la borne [0, 100]", () => {
    const candles = candlesFromHLC([
      [10, 8, 9],
      [12, 9, 11],
      [11, 7, 8],
      [13, 10, 12],
      [14, 11, 13],
      [15, 9, 10],
      [13, 8, 12],
      [16, 12, 15],
    ]);
    const { series } = computeIndicator(stochastic, candles, {
      kLength: 3,
      dLength: 3,
    });
    for (const key of ["k", "d"] as const) {
      const out = series[key];
      if (out === undefined) throw new Error(`série ${key} absente`);
      for (const v of out) {
        if (v === undefined) continue;
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it("longueur fractionnaire quantifiée : dLength=2.5 -> arrondi 3, %D non vide", () => {
    const candles = candlesFromHLC([
      [10, 8, 9],
      [12, 9, 11],
      [11, 7, 8],
      [13, 10, 12],
      [14, 11, 13],
      [15, 9, 10],
      [13, 8, 12],
      [16, 12, 15],
    ]);
    const frac = computeIndicator(stochastic, candles, { kLength: 3, dLength: 2.5 }).series.d;
    expect(frac?.some((v) => v !== undefined)).toBe(true);
    expect(frac).toEqual(
      computeIndicator(stochastic, candles, { kLength: 3, dLength: 3 }).series.d
    );
  });
});
