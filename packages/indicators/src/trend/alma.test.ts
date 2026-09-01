/**
 * @axiom/indicators — trend/alma.test.ts
 *
 * ALMA = moyenne à pondération gaussienne décalée. On teste les PROPRIÉTÉS.
 *   - longueur alignée ; amorçage undefined sur les (window−1) premières barres ;
 *   - valeurs finies ;
 *   - sur une série constante, ALMA = cette constante (Σw·c / Σw = c).
 */

import { describe, expect, it } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { alma } from "./alma";

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

describe("alma (trend, overlay)", () => {
  const candles = candlesFromCloses(
    Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i / 2) * 6)
  );

  it("amorce undefined sur les (window − 1) premières barres", () => {
    const { series } = alma.calc(candles, { window: 9, offset: 0.85, sigma: 6 }, ctx);
    expect(series.alma).toHaveLength(candles.length);
    for (let i = 0; i < 8; i++) expect(series.alma?.[i]).toBeUndefined();
    expect(series.alma?.[8]).toBeDefined();
  });

  it("ne produit que des valeurs finies une fois amorcé", () => {
    const { series } = alma.calc(candles, { window: 9, offset: 0.85, sigma: 6 }, ctx);
    const defined = (series.alma ?? []).filter((v): v is number => v !== undefined);
    expect(defined.length).toBeGreaterThan(0);
    for (const v of defined) expect(Number.isFinite(v)).toBe(true);
  });

  it("vaut exactement la constante sur une série plate", () => {
    const flat = candlesFromCloses(new Array(20).fill(7));
    const { series } = alma.calc(flat, { window: 9, offset: 0.85, sigma: 6 }, ctx);
    expect(series.alma?.[19]).toBeCloseTo(7, 10);
  });

  it("longueur fractionnaire quantifiée : window=8.5 ne lève pas (new Array), ≡ window=9", () => {
    let frac: ReturnType<typeof alma.calc>;
    expect(() => {
      frac = alma.calc(candles, { window: 8.5, offset: 0.85, sigma: 6 }, ctx);
    }).not.toThrow();
    expect(frac!.series.alma?.some((v) => v !== undefined)).toBe(true);
    expect(frac!.series.alma).toEqual(
      alma.calc(candles, { window: 9, offset: 0.85, sigma: 6 }, ctx).series.alma
    );
  });
});
