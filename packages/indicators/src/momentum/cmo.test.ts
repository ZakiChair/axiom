/**
 * @axiom/indicators — momentum/cmo.test.ts
 *
 * CMO (somme simple) : valeurs attendues CALCULÉES À LA MAIN avec length = 3.
 *
 * Closes : [10, 11, 13, 12, 11, 14, 10]  (index 0..6)
 * Deltas (alignés sur la bougie courante) :
 *   c1:+1  c2:+2  c3:-1  c4:-1  c5:+3  c6:-4
 *   gains  (index j -> bougie j+1) : [1, 2, 0, 0, 3, 0]
 *   pertes                          : [0, 0, 1, 1, 0, 4]
 *
 * Sommes roulantes (length=3) et CMO = 100*(Su-Sd)/(Su+Sd) :
 *   bougie3 : Su=1+2+0=3, Sd=0+0+1=1 -> 100*(3-1)/4 = 50
 *   bougie4 : Su=2+0+0=2, Sd=0+1+1=2 -> 100*(2-2)/4 = 0
 *   bougie5 : Su=0+0+3=3, Sd=1+1+0=2 -> 100*(3-2)/5 = 20
 *   bougie6 : Su=0+3+0=3, Sd=1+0+4=5 -> 100*(3-5)/8 = -25
 *
 * index 0,1,2 : undefined (moins de `length` deltas).
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { cmo } from "./cmo";

function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    time: i * 60_000,
    open: close,
    high: close,
    low: close,
    close,
    volume: 0,
  }));
}

describe("CMO (Chande Momentum Oscillator)", () => {
  it("calcule les valeurs hand-calc et amorce undefined (length=3)", () => {
    const candles = candlesFromCloses([10, 11, 13, 12, 11, 14, 10]);
    const { series } = computeIndicator(cmo, candles, { length: 3 });
    const out = series.cmo;
    if (out === undefined) throw new Error("série cmo absente");

    expect(out.length).toBe(candles.length);
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeUndefined();
    expect(out[2]).toBeUndefined();
    expect(out[3]).toBeCloseTo(50, 12);
    expect(out[4]).toBeCloseTo(0, 12);
    expect(out[5]).toBeCloseTo(20, 12);
    expect(out[6]).toBeCloseTo(-25, 12);
  });

  it("respecte la borne [-100, 100]", () => {
    const candles = candlesFromCloses([5, 7, 4, 9, 2, 11, 3, 8, 6, 10]);
    const { series } = computeIndicator(cmo, candles, { length: 3 });
    const out = series.cmo;
    if (out === undefined) throw new Error("série cmo absente");
    for (const v of out) {
      if (v === undefined) continue;
      expect(v).toBeGreaterThanOrEqual(-100);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});
