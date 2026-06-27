/**
 * @axiom/indicators — momentum/momentum.test.ts
 *
 * Momentum est linéaire : valeurs attendues CALCULÉES À LA MAIN.
 *
 * Closes : [10, 11, 9, 12, 15]  (index 0..4), length = 2.
 *   mom[2] = 9 - 10  = -1
 *   mom[3] = 12 - 11 =  1
 *   mom[4] = 15 - 9  =  6
 *   index 0,1 : undefined.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { momentum } from "./momentum";

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

describe("Momentum", () => {
  it("calcule la différence absolue et amorce undefined (length=2)", () => {
    const candles = candlesFromCloses([10, 11, 9, 12, 15]);
    const { series } = computeIndicator(momentum, candles, { length: 2 });
    const out = series.mom;
    if (out === undefined) throw new Error("série mom absente");

    expect(out.length).toBe(candles.length);
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeUndefined();
    expect(out[2]).toBeCloseTo(-1, 12);
    expect(out[3]).toBeCloseTo(1, 12);
    expect(out[4]).toBeCloseTo(6, 12);
  });
});
