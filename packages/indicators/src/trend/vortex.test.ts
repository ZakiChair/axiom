/**
 * @axiom/indicators — trend/vortex.test.ts
 *
 * Vortex est une somme de mouvements normalisée par l'ATR : linéaire et traçable.
 * On teste un cas EXACT calculé à la main (length=2) + des propriétés (positivité,
 * amorçage, longueurs).
 *
 * Bougies (H, L, C) :
 *   i0: H=10, L=8,  C=9
 *   i1: H=12, L=9,  C=11
 *   i2: H=11, L=10, C=10
 *   i3: H=15, L=11, C=14
 *
 * TR (utils.trueRange) = [2, 3, 1, 5]
 * VM+ = |H[i]-L[i-1]| : i1=|12-8|=4, i2=|11-9|=2, i3=|15-10|=5
 * VM- = |L[i]-H[i-1]| : i1=|9-10|=1, i2=|10-12|=2, i3=|11-11|=0
 *
 * Sommes roulantes (length=2) à partir des séries compactées (bougies 1..3) :
 *   bougie2 : ΣTR=3+1=4,  ΣVM+=4+2=6,  ΣVM-=1+2=3  -> VI+=6/4=1.5,    VI-=3/4=0.75
 *   bougie3 : ΣTR=1+5=6,  ΣVM+=2+5=7,  ΣVM-=2+0=2  -> VI+=7/6=1.1666…, VI-=2/6=0.3333…
 *
 * Indices 0 et 1 : undefined (fenêtre non pleine).
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { vortex } from "./vortex";

function candlesFromHLC(
  rows: Array<[high: number, low: number, close: number]>
): Candle[] {
  return rows.map(([high, low, close], i) => ({
    time: i * 60_000,
    open: close,
    high,
    low,
    close,
    volume: 0,
  }));
}

describe("Vortex", () => {
  it("valeurs exactes hand-calc (length=2) + amorçage undefined", () => {
    const candles = candlesFromHLC([
      [10, 8, 9],
      [12, 9, 11],
      [11, 10, 10],
      [15, 11, 14],
    ]);
    const { series } = computeIndicator(vortex, candles, { length: 2 });
    const viPlus = series.viPlus!;
    const viMinus = series.viMinus!;

    expect(viPlus.length).toBe(candles.length);
    expect(viPlus[0]).toBeUndefined();
    expect(viPlus[1]).toBeUndefined();

    expect(viPlus[2]).toBeCloseTo(1.5, 9);
    expect(viMinus[2]).toBeCloseTo(0.75, 9);
    expect(viPlus[3]).toBeCloseTo(7 / 6, 9);
    expect(viMinus[3]).toBeCloseTo(1 / 3, 9);
  });

  it("VI+ et VI- sont strictement positifs et finis sur une série quelconque", () => {
    const rows: Array<[number, number, number]> = [];
    for (let i = 0; i < 40; i++) {
      const base = 100 + Math.sin(i / 4) * 12;
      rows.push([base + 2, base - 2, base]);
    }
    const candles = candlesFromHLC(rows);
    const { series } = computeIndicator(vortex, candles, { length: 14 });
    for (const key of ["viPlus", "viMinus"]) {
      const s = series[key]!;
      for (let i = 0; i < s.length; i++) {
        const v = s[i];
        if (v === undefined) continue;
        expect(v).toBeGreaterThan(0);
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});
