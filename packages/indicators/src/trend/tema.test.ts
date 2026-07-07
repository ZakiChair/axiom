/**
 * @axiom/indicators — trend/tema.test.ts
 *
 * TEMA = 3·e1 − 3·e2 + e3 : non-linéaire, on teste les PROPRIÉTÉS.
 *   - longueur alignée ; amorçage undefined ; valeurs finies ;
 *   - sur une constante, une MA doit converger vers cette constante.
 */

import { describe, expect, it } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { tema } from "./tema";

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

describe("tema (trend, overlay)", () => {
  const candles = candlesFromCloses(
    Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i / 4) * 5)
  );

  it("produit une série alignée et amorcée à undefined", () => {
    const { series } = tema.calc(candles, { length: 8 }, ctx);
    expect(series.tema).toHaveLength(candles.length);
    expect(series.tema?.[0]).toBeUndefined();
  });

  it("ne produit que des valeurs finies une fois amorcé", () => {
    const { series } = tema.calc(candles, { length: 8 }, ctx);
    const defined = (series.tema ?? []).filter((v): v is number => v !== undefined);
    expect(defined.length).toBeGreaterThan(0);
    for (const v of defined) expect(Number.isFinite(v)).toBe(true);
  });

  it("converge vers la constante sur une série plate", () => {
    const flat = candlesFromCloses(new Array(40).fill(42));
    const { series } = tema.calc(flat, { length: 8 }, ctx);
    const s = series.tema ?? [];
    const last = s[s.length - 1];
    expect(last).toBeDefined();
    if (last !== undefined) expect(last).toBeCloseTo(42, 6);
  });
});
