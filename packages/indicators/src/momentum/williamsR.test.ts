/**
 * @axiom/indicators — momentum/williamsR.test.ts
 *
 * Williams %R : valeurs hand-calc + invariant de borne [-100, 0].
 *
 * Bougies (high, low, close), length = 3 :
 *   i0: h=10 l=8  c=9
 *   i1: h=12 l=9  c=11
 *   i2: h=11 l=7  c=8
 *   i3: h=13 l=10 c=12
 *
 *   i2 (fenêtre i0..i2) : HH=12, LL=7, c=8  -> -100*(12-8)/(12-7) = -80
 *   i3 (fenêtre i1..i3) : HH=13, LL=7, c=12 -> -100*(13-12)/(13-7) = -16.66666...
 *   index 0,1 : undefined.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { williamsR } from "./williamsR";

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

describe("Williams %R", () => {
  it("calcule les valeurs hand-calc et amorce undefined (length=3)", () => {
    const candles = candlesFromHLC([
      [10, 8, 9],
      [12, 9, 11],
      [11, 7, 8],
      [13, 10, 12],
    ]);
    const { series } = computeIndicator(williamsR, candles, { length: 3 });
    const out = series.willr;
    if (out === undefined) throw new Error("série willr absente");

    expect(out.length).toBe(candles.length);
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeUndefined();
    expect(out[2]).toBeCloseTo(-80, 12);
    expect(out[3]).toBeCloseTo(-100 / 6, 12);
  });

  it("respecte la borne [-100, 0]", () => {
    const candles = candlesFromHLC([
      [10, 8, 9],
      [12, 9, 11],
      [11, 7, 8],
      [13, 10, 12],
      [14, 11, 11],
      [15, 9, 14],
      [13, 8, 9],
    ]);
    const { series } = computeIndicator(williamsR, candles, { length: 4 });
    const out = series.willr;
    if (out === undefined) throw new Error("série willr absente");
    for (const v of out) {
      if (v === undefined) continue;
      expect(v).toBeGreaterThanOrEqual(-100);
      expect(v).toBeLessThanOrEqual(0);
    }
  });
});
