/**
 * @axiom/indicators — trend/t3.test.ts
 *
 * T3 = GD(GD(GD(close))) : fortement non-linéaire, on teste les PROPRIÉTÉS (pas
 * de fausse précision §15.4).
 *   - longueur alignée ; amorçage undefined ; valeurs finies ;
 *   - convergence vers la constante sur une série plate.
 */

import { describe, expect, it } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { t3 } from "./t3";

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

const ctx: CalcContext = { hl2: [], hlc3: [], ohlc4: [], source: [] };

describe("t3 (trend, overlay)", () => {
  const candles = candlesFromCloses(
    Array.from({ length: 60 }, (_, i) => 50 + i * 0.3 + Math.cos(i / 5) * 3)
  );

  it("produit une série alignée et amorcée à undefined", () => {
    const { series } = t3.calc(candles, { length: 5, v: 0.7 }, ctx);
    expect(series.t3).toHaveLength(candles.length);
    expect(series.t3?.[0]).toBeUndefined();
  });

  it("ne produit que des valeurs finies une fois amorcé", () => {
    const { series } = t3.calc(candles, { length: 5, v: 0.7 }, ctx);
    const defined = (series.t3 ?? []).filter((v): v is number => v !== undefined);
    expect(defined.length).toBeGreaterThan(0);
    for (const v of defined) expect(Number.isFinite(v)).toBe(true);
  });

  it("converge vers la constante sur une série plate", () => {
    const flat = candlesFromCloses(new Array(50).fill(20));
    const { series } = t3.calc(flat, { length: 5, v: 0.7 }, ctx);
    const s = series.t3 ?? [];
    const last = s[s.length - 1];
    expect(last).toBeDefined();
    if (last !== undefined) expect(last).toBeCloseTo(20, 6);
  });
});
