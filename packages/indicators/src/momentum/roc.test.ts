/**
 * @axiom/indicators — momentum/roc.test.ts
 *
 * ROC est linéaire : valeurs attendues CALCULÉES À LA MAIN.
 *
 * Closes : [10, 11, 10, 12, 13]  (index 0..4), length = 2.
 *   roc[2] = 100*(10-10)/10 = 0
 *   roc[3] = 100*(12-11)/11 = 100/11 = 9.090909...
 *   roc[4] = 100*(13-10)/10 = 30
 *   index 0,1 : undefined (pas de clôture de référence).
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { roc } from "./roc";

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

describe("ROC", () => {
  it("calcule la variation en % et amorce undefined (length=2)", () => {
    const candles = candlesFromCloses([10, 11, 10, 12, 13]);
    const { series } = computeIndicator(roc, candles, { length: 2 });
    const out = series.roc;
    if (out === undefined) throw new Error("série roc absente");

    expect(out.length).toBe(candles.length);
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeUndefined();
    expect(out[2]).toBeCloseTo(0, 12);
    expect(out[3]).toBeCloseTo(100 / 11, 12);
    expect(out[4]).toBeCloseTo(30, 12);
  });

  it("longueur fractionnaire quantifiée : roc(9.5) === roc(10), série non vide", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    const candles = candlesFromCloses(closes);
    const frac = computeIndicator(roc, candles, { length: 9.5 }).series.roc;
    expect(frac?.some((v) => v !== undefined)).toBe(true);
    expect(frac).toEqual(computeIndicator(roc, candles, { length: 10 }).series.roc);
  });
});
