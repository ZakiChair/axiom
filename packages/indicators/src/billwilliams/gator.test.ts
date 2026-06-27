/**
 * @axiom/indicators — billwilliams/gator.test.ts
 *
 * Vérifie les invariants du Gator Oscillator : longueur alignée, amorçage,
 * upper >= 0 (au-dessus de zéro) et lower <= 0 (sous zéro), valeurs finies.
 *
 * Vérification exacte (length=2, shift=1) sur prix plats [10, 20, 30, 40, 50] :
 *   median = prix ; rma(2) : rma[1]=15, rma[2]=22.5, rma[3]=31.25, rma[4]=40.625
 *   jaw/teeth/lips identiques (mêmes length/shift) -> upper et lower nuls là où
 *   les trois lignes coïncident.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { gator } from "./gator";

function flatCandles(prices: number[]): Candle[] {
  return prices.map((p, i) => ({
    time: i * 60_000,
    open: p,
    high: p,
    low: p,
    close: p,
    volume: 0,
  }));
}

describe("Gator Oscillator (Bill Williams)", () => {
  it("annule les histogrammes quand jaw=teeth=lips (paramètres identiques)", () => {
    const candles = flatCandles([10, 20, 30, 40, 50]);
    const { series } = computeIndicator(gator, candles, {
      jawLength: 2,
      jawShift: 1,
      teethLength: 2,
      teethShift: 1,
      lipsLength: 2,
      lipsShift: 1,
    });
    const upper = series.upper;
    const lower = series.lower;
    if (upper === undefined || lower === undefined) {
      throw new Error("séries gator absentes");
    }

    expect(upper.length).toBe(candles.length);
    // index 2..4 définis (rma[1..3] décalés de 1) ; lignes égales -> 0.
    expect(upper[2]).toBeCloseTo(0, 12);
    expect(lower[2]).toBeCloseTo(0, 12);
  });

  it("respecte les invariants de signe et de finitude (défauts canoniques)", () => {
    const prices = Array.from({ length: 40 }, (_, i) => 100 + Math.cos(i / 2) * 7);
    const candles = flatCandles(prices);
    const { series } = computeIndicator(gator, candles);
    const upper = series.upper;
    const lower = series.lower;
    if (upper === undefined || lower === undefined) {
      throw new Error("séries gator absentes");
    }

    expect(upper.length).toBe(candles.length);
    expect(lower.length).toBe(candles.length);

    for (const v of upper) {
      if (v !== undefined) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0); // histogramme haut >= 0
      }
    }
    for (const v of lower) {
      if (v !== undefined) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeLessThanOrEqual(0); // histogramme bas <= 0
      }
    }
  });
});
