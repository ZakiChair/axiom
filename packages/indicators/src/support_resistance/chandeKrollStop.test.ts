/**
 * @axiom/indicators — support_resistance/chandeKrollStop.test.ts
 * Testé avec un TR constant (range fixe) pour rendre l'ATR (rma) déterministe.
 */
import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { chandeKrollStop } from "./chandeKrollStop";

const noCtx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

describe("chandeKrollStop", () => {
  it("TR constant → ATR=range, stops = extrêmes décalés de x·ATR (p=2,x=1,q=2)", () => {
    // Chaque bougie : high=low+2, close=low+1. TR : bougie0 = h-l = 2 ; suivantes :
    // max(2, |h-cPrev|, |l-cPrev|). Avec low croissant de +2/barre, cPrev=lowPrev+1,
    // h=low+2 → |h-cPrev| = |low+2-(lowPrev+1)| = |low+1-lowPrev|. low-lowPrev=2 → =3 ≥2.
    // Pour garder TR=2 constant, gardons low CONSTANT : range fixe, prix plat.
    const low = 10;
    const c: Candle[] = new Array(6).fill(0).map(() => ({
      time: 0,
      open: low + 1,
      high: low + 2,
      low,
      close: low + 1,
      volume: 1,
    }));
    // TR bougie0 = 2 ; suivantes : h-l=2, |h-cPrev|=|12-11|=1, |l-cPrev|=|10-11|=1 → 2. ATR=2 partout.
    const res = chandeKrollStop.calc(c, { p: 2, x: 1, q: 2 }, noCtx);
    // hh(high,2)=12, ll(low,2)=10, ATR=2 → preHigh=12-2=10, preLow=10+2=12.
    // stopHigh=max(preHigh,2)=10 ; stopLow=min(preLow,2)=12. Définis à partir de idx2 (p+q warmup).
    expect(res.series.stopHigh?.[5]).toBeCloseTo(10, 9);
    expect(res.series.stopLow?.[5]).toBeCloseTo(12, 9);
  });

  it("undefined pendant le warmup (avant p+q barres pleines)", () => {
    const c: Candle[] = new Array(3).fill(0).map(() => ({ time: 0, open: 1, high: 2, low: 0, close: 1, volume: 1 }));
    const res = chandeKrollStop.calc(c, { p: 10, x: 1, q: 9 }, noCtx);
    expect(res.series.stopHigh?.[2]).toBeUndefined();
  });

  it("métadonnées (2 lignes, overlay, support_resistance)", () => {
    expect(chandeKrollStop.pane).toBe("overlay");
    expect(chandeKrollStop.category).toBe("support_resistance");
    expect(chandeKrollStop.outputs).toHaveLength(2);
  });

  it("longueur fractionnaire quantifiée : p=1.5/q=1.5 -> arrondis 2, série non vide", () => {
    const low = 10;
    const c: Candle[] = new Array(6).fill(0).map(() => ({
      time: 0,
      open: low + 1,
      high: low + 2,
      low,
      close: low + 1,
      volume: 1,
    }));
    const frac = chandeKrollStop.calc(c, { p: 1.5, x: 1, q: 1.5 }, noCtx).series.stopHigh;
    expect(frac?.some((v) => v !== undefined)).toBe(true);
    expect(frac).toEqual(chandeKrollStop.calc(c, { p: 2, x: 1, q: 2 }, noCtx).series.stopHigh);
  });
});
