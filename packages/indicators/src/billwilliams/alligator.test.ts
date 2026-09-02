/**
 * @axiom/indicators — billwilliams/alligator.test.ts
 *
 * Vérifie l'amorçage `undefined`, l'alignement de longueur, la finitude des lignes,
 * et une valeur SMMA décalée CALCULÉE À LA MAIN.
 *
 * Pour rendre le calcul traçable, on prend des bougies où high = low = close = open,
 * donc median (hl2) = ce prix. Prix : [10, 20, 30, 40, 50] (index 0..4).
 *
 * SMMA = rma (Wilder), length = 2, amorce = SMA des 2 premières valeurs à l'index 1 :
 *   rma[1] = (10+20)/2 = 15
 *   rma[2] = 15 + (30-15)/2 = 22.5
 *   rma[3] = 22.5 + (40-22.5)/2 = 31.25
 *   rma[4] = 31.25 + (50-31.25)/2 = 40.625
 *
 * Jaw avec shift = 1 : jaw[i] = rma[i-1]
 *   jaw[0] = undefined, jaw[1] = undefined (rma[0] indéfini),
 *   jaw[2] = 15, jaw[3] = 22.5, jaw[4] = 31.25
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { alligator } from "./alligator";

/** Bougies plates : O=H=L=C = prix, donc hl2 = prix. */
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

describe("Alligator (Bill Williams)", () => {
  it("décale la SMMA vers le futur (jaw, length=2 shift=1, hand-calc)", () => {
    const candles = flatCandles([10, 20, 30, 40, 50]);
    const { series } = computeIndicator(alligator, candles, {
      jawLength: 2,
      jawShift: 1,
      teethLength: 2,
      teethShift: 1,
      lipsLength: 2,
      lipsShift: 1,
    });
    const jaw = series.jaw;
    if (jaw === undefined) throw new Error("série jaw absente");

    expect(jaw.length).toBe(candles.length);
    expect(jaw[0]).toBeUndefined();
    expect(jaw[1]).toBeUndefined();
    expect(jaw[2]).toBeCloseTo(15, 9);
    expect(jaw[3]).toBeCloseTo(22.5, 9);
    expect(jaw[4]).toBeCloseTo(31.25, 9);
  });

  it("respecte l'amorçage des défauts canoniques et reste fini (13/8, 8/5, 5/3)", () => {
    // 40 bougies suffisent pour amorcer les trois lignes (jaw : 13-1+8 = index 20).
    const prices = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i) * 5);
    const candles = flatCandles(prices);
    const { series } = computeIndicator(alligator, candles);
    const jaw = series.jaw;
    const teeth = series.teeth;
    const lips = series.lips;
    if (jaw === undefined || teeth === undefined || lips === undefined) {
      throw new Error("séries alligator absentes");
    }

    expect(jaw.length).toBe(candles.length);
    expect(teeth.length).toBe(candles.length);
    expect(lips.length).toBe(candles.length);

    // Jaw définie à partir de l'index jawLength-1 + jawShift = 12 + 8 = 20.
    expect(jaw[19]).toBeUndefined();
    expect(jaw[20]).toBeDefined();
    // Teeth : teethLength-1 + teethShift = 7 + 5 = 12.
    expect(teeth[11]).toBeUndefined();
    expect(teeth[12]).toBeDefined();
    // Lips : lipsLength-1 + lipsShift = 4 + 3 = 7.
    expect(lips[6]).toBeUndefined();
    expect(lips[7]).toBeDefined();

    // Toutes les valeurs définies sont finies.
    for (const line of [jaw, teeth, lips]) {
      for (const v of line) {
        if (v !== undefined) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it("décalages fractionnaires quantifiés : 8.4/5.4/3.4 -> arrondis 8/5/3, séries non vides", () => {
    const prices = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i) * 5);
    const candles = flatCandles(prices);
    const frac = computeIndicator(alligator, candles, {
      jawShift: 8.4,
      teethShift: 5.4,
      lipsShift: 3.4,
    }).series;
    const entier = computeIndicator(alligator, candles).series;
    expect(frac.jaw?.some((v) => v !== undefined)).toBe(true);
    expect(frac.teeth?.some((v) => v !== undefined)).toBe(true);
    expect(frac.lips?.some((v) => v !== undefined)).toBe(true);
    expect(frac.jaw).toEqual(entier.jaw);
    expect(frac.teeth).toEqual(entier.teeth);
    expect(frac.lips).toEqual(entier.lips);
  });
});
