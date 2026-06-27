/**
 * @axiom/indicators — support_resistance/pivotHighLow.test.ts
 *
 * Indicateur SIMPLE (comparaison locale) -> on vérifie les pivots EXACTS attendus.
 * Fenêtre bars=2. Séries construites pour un unique pivot haut et un unique
 * pivot bas dans la plage valide d'indices [bars, n−1−bars] = [2, 6] (n=9) :
 *
 *   idx :   0   1   2   3   4   5   6   7   8
 *   high:  10  11  12  20  13  12  11  10   9
 *   low :   8   7   6   5   4   1   4   5   6
 *
 *   Pivot HAUT : seul l'index 3 (high=20) est strictement > aux ±2 voisins.
 *   Pivot BAS  : seul l'index 5 (low=1)  est strictement < aux ±2 voisins.
 *   Bordures : les 2 premières et 2 dernières bougies -> undefined.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { pivotHighLow } from "./pivotHighLow";

function candles(highs: number[], lows: number[]): Candle[] {
  return highs.map((h, i) => {
    const l = lows[i]!;
    return {
      time: i * 60_000,
      open: (h + l) / 2,
      high: h,
      low: l,
      close: (h + l) / 2,
      volume: 0,
    };
  });
}

describe("Pivot High/Low", () => {
  it("détecte un pivot haut et un pivot bas stricts (bars=2)", () => {
    const highs = [10, 11, 12, 20, 13, 12, 11, 10, 9];
    const lows = [8, 7, 6, 5, 4, 1, 4, 5, 6];
    const cs = candles(highs, lows);
    const { series } = computeIndicator(pivotHighLow, cs, { bars: 2 });

    const ph = series.pivotHigh;
    const pl = series.pivotLow;
    if (ph === undefined || pl === undefined) throw new Error("séries absentes");

    // (a) longueurs alignées.
    expect(ph.length).toBe(cs.length);
    expect(pl.length).toBe(cs.length);

    // (a) bordures undefined : 2 premières et 2 dernières (bars=2).
    for (const idx of [0, 1, 7, 8]) {
      expect(ph[idx]).toBeUndefined();
      expect(pl[idx]).toBeUndefined();
    }

    // Pivot haut unique à l'index 3 (= 20), pivot bas unique à l'index 5 (= 1).
    expect(ph[3]).toBe(20);
    expect(pl[5]).toBe(1);

    // Aucun autre pivot dans la plage valide.
    for (let i = 2; i <= 6; i++) {
      if (i !== 3) expect(ph[i]).toBeUndefined();
      if (i !== 5) expect(pl[i]).toBeUndefined();
    }
  });

  it("ne renvoie aucun pivot si la série est trop courte pour la fenêtre", () => {
    const highs = [1, 2, 3];
    const lows = [1, 2, 3];
    const cs = candles(highs, lows);
    const { series } = computeIndicator(pivotHighLow, cs, { bars: 5 });
    const ph = series.pivotHigh!;
    const pl = series.pivotLow!;
    expect(ph.length).toBe(3);
    expect(pl.length).toBe(3);
    expect(ph.every((v) => v === undefined)).toBe(true);
    expect(pl.every((v) => v === undefined)).toBe(true);
  });
});
