/**
 * @axiom/indicators — momentum/cci.test.ts
 *
 * CCI : valeurs hand-calc (high=low=close => tp = close) avec length = 3.
 *
 * Closes = tp : [1, 2, 3, 4, 2]
 *   SMA(tp,3) : idx2=2, idx3=3, idx4=3
 *   meanDev (toujours 2/3 ici) :
 *     idx2: (|1-2|+|2-2|+|3-2|)/3 = 2/3 ; 0.015*2/3 = 0.01 ; (3-2)/0.01 =  100
 *     idx3: (|2-3|+|3-3|+|4-3|)/3 = 2/3 ; (4-3)/0.01      =  100
 *     idx4: (|3-3|+|4-3|+|2-3|)/3 = 2/3 ; (2-3)/0.01      = -100
 *   index 0,1 : undefined.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { cci } from "./cci";

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

describe("CCI", () => {
  it("calcule les valeurs hand-calc et amorce undefined (length=3)", () => {
    const candles = candlesFromCloses([1, 2, 3, 4, 2]);
    const { series } = computeIndicator(cci, candles, { length: 3 });
    const out = series.cci;
    if (out === undefined) throw new Error("série cci absente");

    expect(out.length).toBe(candles.length);
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeUndefined();
    expect(out[2]).toBeCloseTo(100, 9);
    expect(out[3]).toBeCloseTo(100, 9);
    expect(out[4]).toBeCloseTo(-100, 9);
  });

  it("produit des valeurs finies (pas de NaN/Infinity)", () => {
    const candles = candlesFromCloses([10, 12, 11, 13, 9, 14, 8, 15, 12, 11]);
    const { series } = computeIndicator(cci, candles, { length: 4 });
    const out = series.cci;
    if (out === undefined) throw new Error("série cci absente");
    for (const v of out) {
      if (v === undefined) continue;
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});
