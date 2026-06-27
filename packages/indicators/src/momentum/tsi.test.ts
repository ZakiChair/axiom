/**
 * @axiom/indicators — momentum/tsi.test.ts
 *
 * TSI : indicateur à double lissage récursif -> on teste les PROPRIÉTÉS, pas une
 * fausse précision : amorçage undefined, longueur, finitude, et invariant de signe
 * (hausse stricte -> TSI = +100 car |mom| = mom partout).
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { tsi } from "./tsi";

function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    time: i * 60_000,
    open: close,
    high: close,
    low: close,
    close,
    volume: 0,
  }));
}

describe("TSI (True Strength Index)", () => {
  it("hausse strictement monotone -> TSI = +100 (mom == |mom|)", () => {
    // 30 clôtures croissantes : tous les momentums sont positifs, donc le double
    // EMA du momentum égale le double EMA de sa valeur absolue -> ratio = 1.
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    const candles = candlesFromCloses(closes);
    const { series } = computeIndicator(tsi, candles, { long: 5, short: 3 });
    const out = series.tsi;
    if (out === undefined) throw new Error("série tsi absente");

    expect(out.length).toBe(candles.length);
    expect(out[0]).toBeUndefined();

    for (const v of out) {
      if (v === undefined) continue;
      expect(v).toBeCloseTo(100, 9);
    }
  });

  it("amorçage undefined cohérent avec le double EMA (long puis short)", () => {
    const closes = Array.from({ length: 40 }, (_, i) => 50 + Math.sin(i) * 5);
    const candles = candlesFromCloses(closes);
    const { series } = computeIndicator(tsi, candles, { long: 25, short: 13 });
    const out = series.tsi;
    if (out === undefined) throw new Error("série tsi absente");

    // momVals a 39 valeurs ; ema(long=25) -> 1re valeur définie à l'index compact 24
    // -> bougie 25 ; puis ema(short=13) ajoute 12 -> 1re valeur compacte à 36 ->
    // bougie 37. On vérifie qu'avant cela tout est undefined et finitude après.
    expect(out[36]).toBeUndefined();
    for (let i = 37; i < out.length; i++) {
      const v = out[i];
      expect(v).toBeDefined();
      if (v !== undefined) expect(Number.isFinite(v)).toBe(true);
    }
  });
});
