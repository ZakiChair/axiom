/**
 * @axiom/indicators — momentum/stochRsi.test.ts
 *
 * Stochastic RSI : indicateur composite (RSI + stoch + double lissage). On NE
 * fabrique PAS de valeur exacte (anti fausse-précision §15.4) ; on vérifie les
 * INVARIANTS : longueur, amorçage undefined, borne [0, 100], valeurs finies.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { stochRsi } from "./stochRsi";

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

/** Série déterministe et variée (sinusoïde bruitée) pour exercer l'oscillateur. */
function syntheticCloses(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(100 + 10 * Math.sin(i / 3) + 3 * Math.sin(i / 1.3) + (i % 5));
  }
  return out;
}

describe("Stochastic RSI", () => {
  const candles = candlesFromCloses(syntheticCloses(80));
  const { series } = computeIndicator(stochRsi, candles, {
    rsiLength: 14,
    stochLength: 14,
    kSmooth: 3,
    dSmooth: 3,
  });

  it("aligne les sorties sur l'entrée et amorce undefined", () => {
    const k = series.k;
    const d = series.d;
    if (k === undefined || d === undefined) throw new Error("séries absentes");
    expect(k.length).toBe(candles.length);
    expect(d.length).toBe(candles.length);
    // Avant la fenêtre RSI pleine, aucune valeur possible.
    expect(k[0]).toBeUndefined();
    expect(d[0]).toBeUndefined();
    expect(k[13]).toBeUndefined();
  });

  it("respecte la borne [0, 100] et reste fini", () => {
    for (const key of ["k", "d"] as const) {
      const out = series[key];
      if (out === undefined) throw new Error(`série ${key} absente`);
      let defined = 0;
      for (const v of out) {
        if (v === undefined) continue;
        defined++;
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
      // Sanité : l'indicateur finit par produire des valeurs.
      expect(defined).toBeGreaterThan(0);
    }
  });

  it("longueur fractionnaire quantifiée : stochLength=13.5 -> arrondi 14, série non vide", () => {
    const frac = computeIndicator(stochRsi, candles, {
      rsiLength: 14,
      stochLength: 13.5,
      kSmooth: 3,
      dSmooth: 3,
    }).series.k;
    expect(frac?.some((v) => v !== undefined)).toBe(true);
    expect(frac).toEqual(series.k);
  });

  it("longueur fractionnaire quantifiée : kSmooth=2.5 -> arrondi 3 (smaOfDefined local), non vide", () => {
    const frac = computeIndicator(stochRsi, candles, {
      rsiLength: 14,
      stochLength: 14,
      kSmooth: 2.5,
      dSmooth: 3,
    }).series.k;
    expect(frac?.some((v) => v !== undefined)).toBe(true);
    expect(frac).toEqual(
      computeIndicator(stochRsi, candles, {
        rsiLength: 14,
        stochLength: 14,
        kSmooth: 3,
        dSmooth: 3,
      }).series.k
    );
  });
});
