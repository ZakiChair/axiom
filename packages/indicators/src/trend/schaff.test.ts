/**
 * @axiom/indicators — trend/schaff.test.ts
 *
 * Stratégie : STC est non linéaire (double stochastique lissé) — PAS de fausse
 * précision. On vérifie les PROPRIÉTÉS :
 *  (a) longueur de sortie + amorçage `undefined` ;
 *  (b) INVARIANT de borne : toute valeur définie ∈ [0, 100] et finie.
 */

import { describe, expect, it } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { schaff } from "./schaff";

function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((c, i) => ({
    time: i * 60_000,
    open: c,
    high: c,
    low: c,
    close: c,
    volume: 0,
  }));
}

const emptyCtx: CalcContext = { hl2: [], hlc3: [], ohlc4: [] };

describe("schaff", () => {
  it("borné [0,100], fini, amorçage undefined, longueur conservée", () => {
    // Série assez longue (> slow 50 + cycles) et oscillante pour exercer les bornes.
    const closes = Array.from(
      { length: 300 },
      (_, i) => 100 + Math.sin(i / 7) * 20 + Math.cos(i / 23) * 10 + i * 0.05
    );
    const candles = candlesFromCloses(closes);
    const { series } = schaff.calc(candles, {}, emptyCtx);
    const out = series.stc ?? [];

    expect(out).toHaveLength(300);
    expect(out[0]).toBeUndefined();
    // Au moins une valeur calculée doit apparaître.
    expect(out.some((v) => v !== undefined)).toBe(true);

    for (const v of out) {
      if (v === undefined) continue;
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it("tout undefined si trop peu de bougies (< slow)", () => {
    const candles = candlesFromCloses([1, 2, 3, 4, 5]);
    const { series } = schaff.calc(candles, {}, emptyCtx);
    const out = series.stc ?? [];
    expect(out).toHaveLength(5);
    expect(out.every((v) => v === undefined)).toBe(true);
  });
});
