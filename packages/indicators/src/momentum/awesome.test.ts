/**
 * @axiom/indicators — momentum/awesome.test.ts
 *
 * AO est linéaire (différence de deux SMA) : on peut donc poser une valeur EXACTE
 * calculée à la main, en plus de l'amorçage et de la longueur.
 *
 * hl2 = (high + low) / 2. On choisit high = low = close pour que hl2 = close.
 * Closes : [10, 12, 14, 16, 18]  -> hl2 identiques.
 * fast = 2, slow = 4 :
 *   SMA(hl2,2) : idx1=11, idx2=13, idx3=15, idx4=17
 *   SMA(hl2,4) : idx3=(10+12+14+16)/4=13, idx4=(12+14+16+18)/4=15
 *   AO = SMA2 - SMA4 : idx3 = 15-13 = 2 ; idx4 = 17-15 = 2
 *   idx0..2 -> undefined (SMA4 non pleine).
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { awesome } from "./awesome";

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

describe("Awesome Oscillator", () => {
  it("valeur exacte hand-calc (fast=2, slow=4)", () => {
    const candles = candlesFromMedian([10, 12, 14, 16, 18]);
    const { series } = computeIndicator(awesome, candles, { fast: 2, slow: 4 });
    const out = series.ao;
    if (out === undefined) throw new Error("série ao absente");

    expect(out.length).toBe(candles.length);
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeUndefined();
    expect(out[2]).toBeUndefined();
    expect(out[3]).toBeCloseTo(2, 12);
    expect(out[4]).toBeCloseTo(2, 12);
  });
});
