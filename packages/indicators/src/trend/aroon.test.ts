/**
 * @axiom/indicators — trend/aroon.test.ts
 *
 * Aroon est linéaire et déterministe : on combine PROPRIÉTÉS (bornes [0,100],
 * amorçage) et VALEURS EXACTES calculées à la main sur des séries monotones.
 *
 * Série de hauts ET bas strictement croissants (length=3) :
 *   - le plus haut de chaque fenêtre est TOUJOURS la bougie courante -> barsSince=0
 *     -> AroonUp = 100*(3-0)/3 = 100
 *   - le plus bas de chaque fenêtre est TOUJOURS la plus ancienne (index i-3)
 *     -> barsSince=3 -> AroonDown = 100*(3-3)/3 = 0
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { aroon } from "./aroon";

function candlesFromHL(rows: Array<[high: number, low: number]>): Candle[] {
  return rows.map(([high, low], i) => ({
    time: i * 60_000,
    open: (high + low) / 2,
    high,
    low,
    close: (high + low) / 2,
    volume: 0,
  }));
}

describe("Aroon", () => {
  it("série croissante (length=3) : Up=100, Down=0 ; undefined avant l'index 3", () => {
    const rows: Array<[number, number]> = [];
    for (let i = 0; i < 8; i++) rows.push([10 + i, 8 + i]);
    const candles = candlesFromHL(rows);
    const { series } = computeIndicator(aroon, candles, { length: 3 });
    const up = series.up!;
    const down = series.down!;

    expect(up.length).toBe(candles.length);
    // Amorçage : indices 0..2 undefined.
    expect(up[2]).toBeUndefined();
    expect(down[2]).toBeUndefined();
    for (let i = 3; i < candles.length; i++) {
      expect(up[i]).toBeCloseTo(100, 9);
      expect(down[i]).toBeCloseTo(0, 9);
    }
  });

  it("série décroissante (length=3) : Up=0, Down=100 (cas symétrique exact)", () => {
    const rows: Array<[number, number]> = [];
    for (let i = 0; i < 8; i++) rows.push([100 - i, 98 - i]);
    const candles = candlesFromHL(rows);
    const { series } = computeIndicator(aroon, candles, { length: 3 });
    const up = series.up!;
    const down = series.down!;
    for (let i = 3; i < candles.length; i++) {
      expect(up[i]).toBeCloseTo(0, 9);
      expect(down[i]).toBeCloseTo(100, 9);
    }
  });

  it("borne les deux sorties dans [0, 100] sur une série quelconque", () => {
    const rows: Array<[number, number]> = [];
    for (let i = 0; i < 40; i++) {
      const base = 50 + Math.sin(i / 3) * 10;
      rows.push([base + 1, base - 1]);
    }
    const candles = candlesFromHL(rows);
    const { series } = computeIndicator(aroon, candles, { length: 14 });
    for (const key of ["up", "down"]) {
      const s = series[key]!;
      for (let i = 0; i < s.length; i++) {
        const v = s[i];
        if (v === undefined) continue;
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it("longueur fractionnaire quantifiée : length=13.5 -> arrondi 14, série non vide", () => {
    const rows: Array<[number, number]> = [];
    for (let i = 0; i < 40; i++) {
      const base = 50 + Math.sin(i / 3) * 10;
      rows.push([base + 1, base - 1]);
    }
    const candles = candlesFromHL(rows);
    const frac = computeIndicator(aroon, candles, { length: 13.5 }).series.up;
    expect(frac?.some((v) => v !== undefined)).toBe(true);
    expect(frac).toEqual(computeIndicator(aroon, candles, { length: 14 }).series.up);
  });
});
