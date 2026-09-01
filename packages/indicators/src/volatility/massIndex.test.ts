/**
 * Test unitaire — Mass Index.
 * Propriétés (double EMA + somme -> pas de fausse précision exacte) :
 *  - série alignée ;
 *  - amorçage undefined jusqu'à l'index 2*(emaLength-1) + sumLength - 1 (= 40 défaut) ;
 *  - valeurs finies et > 0 (somme de ratios ema1/ema2 positifs).
 */

import { describe, it, expect } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { massIndex } from "./massIndex";

const ctx: CalcContext = { hl2: [], hlc3: [], ohlc4: [], source: [] };

describe("massIndex", () => {
  const candles: Candle[] = Array.from({ length: 60 }, (_, i) => {
    const base = 100 + i * 0.3;
    const span = 1 + Math.abs(Math.sin(i)) * 3; // amplitude variable > 0
    return {
      time: i * 60_000,
      open: base,
      high: base + span,
      low: base - span,
      close: base,
      volume: 0,
    };
  });
  const { series } = massIndex.calc(
    candles,
    { emaLength: 9, sumLength: 25 },
    ctx
  );

  it("expose une série alignée sur les bougies", () => {
    expect(Object.keys(series)).toEqual(["massIndex"]);
    expect(series.massIndex).toHaveLength(60);
  });

  it("laisse undefined avant l'index 40 (amorçage double EMA + somme)", () => {
    expect(series.massIndex?.[39]).toBeUndefined();
    expect(series.massIndex?.[40]).toBeDefined();
  });

  it("produit des valeurs finies et positives", () => {
    for (const v of series.massIndex ?? []) {
      if (v === undefined) continue;
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });

  it("longueur fractionnaire quantifiée : sumLength=24.5 -> arrondi 25, série non vide", () => {
    const frac = massIndex.calc(candles, { emaLength: 9, sumLength: 24.5 }, ctx).series.massIndex;
    expect(frac?.some((v) => v !== undefined)).toBe(true);
    expect(frac).toEqual(series.massIndex);
  });
});
