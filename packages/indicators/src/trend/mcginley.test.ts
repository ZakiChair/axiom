/**
 * @axiom/indicators — trend/mcginley.test.ts
 *
 * McGinley Dynamic est récursif et non-linéaire : on teste les PROPRIÉTÉS.
 *   - longueur alignée ; défini dès la 1re bougie (amorce = close[0]) ;
 *   - valeurs finies ;
 *   - sur une série plate, MD reste exactement égal à la constante (close/MD = 1).
 */

import { describe, expect, it } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { mcginley } from "./mcginley";

function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    time: i * 60_000,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }));
}

const ctx: CalcContext = { hl2: [], hlc3: [], ohlc4: [] };

describe("mcginley (trend, overlay)", () => {
  const candles = candlesFromCloses(
    Array.from({ length: 40 }, (_, i) => 100 + i * 0.5 + Math.sin(i / 3) * 3)
  );

  it("est défini dès la première bougie (amorce = close[0])", () => {
    const { series } = mcginley.calc(candles, { length: 14 }, ctx);
    expect(series.mcginley).toHaveLength(candles.length);
    expect(series.mcginley?.[0]).toBeCloseTo(candles[0]?.close ?? NaN, 10);
  });

  it("ne produit que des valeurs finies", () => {
    const { series } = mcginley.calc(candles, { length: 14 }, ctx);
    const defined = (series.mcginley ?? []).filter((v): v is number => v !== undefined);
    expect(defined.length).toBe(candles.length);
    for (const v of defined) expect(Number.isFinite(v)).toBe(true);
  });

  it("reste constant sur une série plate", () => {
    const flat = candlesFromCloses(new Array(20).fill(50));
    const { series } = mcginley.calc(flat, { length: 14 }, ctx);
    expect(series.mcginley?.[19]).toBeCloseTo(50, 10);
  });
});
