/**
 * @axiom/indicators — momentum/elderRay.test.ts
 *
 * Elder Ray = (high - EMA(close,L), low - EMA(close,L)). L'EMA est testée
 * ailleurs : on vérifie l'amorçage, la longueur et l'invariant EXACT
 * bullPower - bearPower == high - low (l'EMA s'annule dans la différence).
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { elderRay } from "./elderRay";

function bar(close: number, i: number): Candle {
  return { time: i * 60_000, open: close, high: close + 2, low: close - 3, close, volume: 100 };
}

describe("Elder Ray", () => {
  it("amorce après l'EMA et vérifie bull - bear == high - low (length=3)", () => {
    const closes = [10, 11, 10, 12, 13, 12, 14, 15];
    const candles = closes.map((c, i) => bar(c, i));
    const { series } = computeIndicator(elderRay, candles, { length: 3 });
    const bull = series.bull;
    const bear = series.bear;
    if (bull === undefined || bear === undefined) throw new Error("séries elderRay absentes");

    expect(bull.length).toBe(candles.length);
    expect(bear.length).toBe(candles.length);

    // EMA(3) amorcée à l'index 2 -> avant : undefined.
    expect(bull[0]).toBeUndefined();
    expect(bull[1]).toBeUndefined();
    expect(bull[2]).toBeDefined();
    expect(bear[2]).toBeDefined();

    // Invariant : bull - bear == high - low == 5 (high=close+2, low=close-3).
    for (let i = 2; i < candles.length; i++) {
      const b = bull[i];
      const s = bear[i];
      expect(b).toBeDefined();
      expect(s).toBeDefined();
      if (b !== undefined && s !== undefined) {
        expect(b - s).toBeCloseTo(5, 12);
        expect(Number.isFinite(b)).toBe(true);
        expect(Number.isFinite(s)).toBe(true);
      }
    }
  });
});
