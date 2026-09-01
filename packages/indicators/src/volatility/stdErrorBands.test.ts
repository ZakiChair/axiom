/**
 * Test unitaire — Standard Error Bands.
 * Propriétés (régression linéaire + SEE -> invariants, pas de fausse précision) :
 *  - 3 séries alignées ;
 *  - amorçage undefined avant `length - 1` ;
 *  - ordre upper >= basis >= lower ;
 *  - sur une droite parfaite, SEE = 0 -> upper == basis == lower == close.
 */

import { describe, it, expect } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { stdErrorBands } from "./stdErrorBands";

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

const ctx: CalcContext = { hl2: [], hlc3: [], ohlc4: [], source: [] };

describe("stdErrorBands", () => {
  const closes = Array.from({ length: 40 }, (_, i) => 100 + 4 * Math.sin(i / 2));
  const candles = candlesFromCloses(closes);
  const { series } = stdErrorBands.calc(candles, { length: 21, mult: 2 }, ctx);

  it("expose 3 séries alignées sur les bougies", () => {
    expect(Object.keys(series).sort()).toEqual(["basis", "lower", "upper"]);
    expect(series.basis).toHaveLength(40);
  });

  it("laisse undefined avant la première fenêtre pleine (length - 1)", () => {
    expect(series.basis?.[19]).toBeUndefined();
    expect(series.basis?.[20]).toBeDefined();
  });

  it("respecte l'ordre upper >= basis >= lower", () => {
    for (let i = 0; i < 40; i++) {
      const b = series.basis?.[i];
      const u = series.upper?.[i];
      const l = series.lower?.[i];
      if (b === undefined || u === undefined || l === undefined) continue;
      expect(u).toBeGreaterThanOrEqual(b);
      expect(b).toBeGreaterThanOrEqual(l);
    }
  });

  it("colle au prix sur une droite parfaite (SEE = 0)", () => {
    const line = candlesFromCloses(
      Array.from({ length: 25 }, (_, i) => 10 + 2 * i)
    );
    const { series: s2 } = stdErrorBands.calc(line, { length: 21, mult: 2 }, ctx);
    // À l'index 24, la régression reconstruit exactement la droite : basis = close.
    expect(s2.basis?.[24]).toBeCloseTo(10 + 2 * 24, 6);
    expect(s2.upper?.[24]).toBeCloseTo(10 + 2 * 24, 6);
    expect(s2.lower?.[24]).toBeCloseTo(10 + 2 * 24, 6);
  });

  it("longueur fractionnaire quantifiée : length=20.5 -> arrondi 21, série non vide", () => {
    const frac = stdErrorBands.calc(candles, { length: 20.5, mult: 2 }, ctx).series.basis;
    expect(frac?.some((v) => v !== undefined)).toBe(true);
    expect(frac).toEqual(stdErrorBands.calc(candles, { length: 21, mult: 2 }, ctx).series.basis);
  });
});
