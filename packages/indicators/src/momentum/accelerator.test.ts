/**
 * @axiom/indicators — momentum/accelerator.test.ts
 *
 * AC = AO - SMA(AO) est linéaire : valeur EXACTE hand-calc possible.
 *
 * hl2 = close (high=low=close). Closes : [10, 12, 14, 16, 18, 22].
 * fast = 2, slow = 4, smaLength = 2 :
 *   SMA(hl2,2) : 1=11, 2=13, 3=15, 4=17, 5=20
 *   SMA(hl2,4) : 3=13, 4=15, 5=17.5
 *   AO = SMA2-SMA4 : 3=2, 4=2, 5=2.5     (0..2 undefined)
 *   SMA(AO,2) sur valeurs définies [2,2,2.5] (idx 3,4,5) : 4=2, 5=2.25  (3 undefined)
 *   AC = AO - SMA(AO) : 4 = 2-2 = 0 ; 5 = 2.5-2.25 = 0.25   (0..3 undefined)
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { accelerator } from "./accelerator";

function candlesFromMedian(meds: number[]): Candle[] {
  return meds.map((m, i) => ({
    time: i * 60_000,
    open: m,
    high: m,
    low: m,
    close: m,
    volume: 0,
  }));
}

describe("Accelerator Oscillator", () => {
  it("valeur exacte hand-calc (fast=2, slow=4, smaLength=2)", () => {
    const candles = candlesFromMedian([10, 12, 14, 16, 18, 22]);
    const { series } = computeIndicator(accelerator, candles, {
      fast: 2,
      slow: 4,
      smaLength: 2,
    });
    const out = series.ac;
    if (out === undefined) throw new Error("série ac absente");

    expect(out.length).toBe(candles.length);
    for (let i = 0; i < 4; i++) expect(out[i]).toBeUndefined();
    expect(out[4]).toBeCloseTo(0, 12);
    expect(out[5]).toBeCloseTo(0.25, 12);
  });
});
