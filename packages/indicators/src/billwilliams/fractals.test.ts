/**
 * @axiom/indicators — billwilliams/fractals.test.ts
 *
 * Vérifie la détection exacte des fractales sur 5 barres et l'absence de marqueur
 * sur les bords (2 premières / 2 dernières barres non confirmables).
 *
 * Highs : [10, 11, 15, 11, 10, 11, 10]  -> pic STRICT au centre i=2 (15 > voisins)
 * Lows  : [ 5,  4,  3,  4,  1,  4,  5]  -> creux STRICT au centre i=4 (1 < voisins)
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { fractals } from "./fractals";

function ohlcCandles(highs: number[], lows: number[]): Candle[] {
  return highs.map((h, i) => {
    const l = lows[i] ?? h;
    const mid = (h + l) / 2;
    return {
      time: i * 60_000,
      open: mid,
      high: h,
      low: l,
      close: mid,
      volume: 0,
    };
  });
}

describe("Fractals (Bill Williams)", () => {
  it("détecte une fractale haute et une fractale basse aux bons index", () => {
    const candles = ohlcCandles(
      [10, 11, 15, 11, 10, 11, 10],
      [5, 4, 3, 4, 1, 4, 5]
    );
    const { series } = computeIndicator(fractals, candles);
    const up = series.up;
    const down = series.down;
    if (up === undefined || down === undefined) {
      throw new Error("séries fractals absentes");
    }

    expect(up.length).toBe(candles.length);
    expect(down.length).toBe(candles.length);

    // Fractale haute unique à i=2, valeur = high[2] = 15.
    expect(up[2]).toBe(15);
    for (let i = 0; i < candles.length; i++) {
      if (i !== 2) expect(up[i]).toBeUndefined();
    }

    // Fractale basse unique à i=4, valeur = low[4] = 1.
    expect(down[4]).toBe(1);
    for (let i = 0; i < candles.length; i++) {
      if (i !== 4) expect(down[i]).toBeUndefined();
    }
  });

  it("ne marque jamais les 2 premières ni les 2 dernières barres", () => {
    // Série monotone : aucune fractale possible nulle part.
    const candles = ohlcCandles(
      [1, 2, 3, 4, 5, 6, 7],
      [1, 2, 3, 4, 5, 6, 7]
    );
    const { series } = computeIndicator(fractals, candles);
    const up = series.up;
    const down = series.down;
    if (up === undefined || down === undefined) {
      throw new Error("séries fractals absentes");
    }
    expect(up.every((v) => v === undefined)).toBe(true);
    expect(down.every((v) => v === undefined)).toBe(true);
  });
});
