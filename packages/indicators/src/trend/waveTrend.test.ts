/**
 * @axiom/indicators — trend/waveTrend.test.ts
 *
 * Stratégie : WaveTrend est non linéaire (EMA imbriquées sur hlc3) — PAS de fausse
 * précision. On vérifie les PROPRIÉTÉS :
 *  (a) longueur de sortie + amorçage `undefined` des deux lignes ;
 *  (b) wt2 (SMA 4 de wt1) démarre APRÈS wt1 ;
 *  (c) valeurs finies.
 */

import { describe, expect, it } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { waveTrend } from "./waveTrend";

/** Bougies OHLC synthétiques (high/low autour de la clôture) — wt utilise hlc3. */
function candlesOHLC(closes: number[]): Candle[] {
  return closes.map((c, i) => ({
    time: i * 60_000,
    open: c,
    high: c + 1,
    low: c - 1,
    close: c,
    volume: 0,
  }));
}

const emptyCtx: CalcContext = { hl2: [], hlc3: [], ohlc4: [], source: [] };

describe("waveTrend", () => {
  it("amorçage undefined, longueur, ordre wt1/wt2, valeurs finies (défauts n1=10 n2=21)", () => {
    const closes = Array.from(
      { length: 120 },
      (_, i) => 100 + Math.sin(i / 6) * 15 + Math.cos(i / 17) * 6
    );
    const candles = candlesOHLC(closes);
    const { series } = waveTrend.calc(candles, {}, emptyCtx);
    const wt1 = series.wt1 ?? [];
    const wt2 = series.wt2 ?? [];

    expect(wt1).toHaveLength(120);
    expect(wt2).toHaveLength(120);
    expect(wt1[0]).toBeUndefined();
    expect(wt2[0]).toBeUndefined();

    const firstWt1 = wt1.findIndex((v) => v !== undefined);
    const firstWt2 = wt2.findIndex((v) => v !== undefined);
    expect(firstWt1).toBeGreaterThanOrEqual(0);
    // wt2 = SMA(wt1, 4) -> démarre 3 barres après wt1.
    expect(firstWt2).toBe(firstWt1 + 3);

    for (const v of wt1) {
      if (v !== undefined) expect(Number.isFinite(v)).toBe(true);
    }
    for (const v of wt2) {
      if (v !== undefined) expect(Number.isFinite(v)).toBe(true);
    }
  });
});
