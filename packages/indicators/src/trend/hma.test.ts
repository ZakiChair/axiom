/**
 * @axiom/indicators — trend/hma.test.ts
 *
 * HMA est non-linéaire (composition de WMA) : on teste les PROPRIÉTÉS, pas une
 * fausse précision (politique anti fausse-précision §15.4).
 *   - longueur de sortie = longueur d'entrée ;
 *   - amorçage : valeurs undefined tant que la fenêtre n'est pas pleine ;
 *   - toutes les valeurs définies sont finies.
 */

import { describe, expect, it } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { hma } from "./hma";

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

// Série déterministe avec variation (oscillation + dérive).
const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 0.5 + Math.sin(i / 3) * 4);
const candles = candlesFromCloses(closes);

describe("hma (trend, overlay)", () => {
  it("produit une série alignée sur les bougies", () => {
    const { series } = hma.calc(candles, { length: 16 }, ctx);
    expect(series.hma).toHaveLength(candles.length);
  });

  it("amorce undefined au tout début", () => {
    const { series } = hma.calc(candles, { length: 16 }, ctx);
    expect(series.hma?.[0]).toBeUndefined();
  });

  it("ne produit que des valeurs finies une fois amorcé", () => {
    const { series } = hma.calc(candles, { length: 16 }, ctx);
    const defined = (series.hma ?? []).filter((v): v is number => v !== undefined);
    expect(defined.length).toBeGreaterThan(0);
    for (const v of defined) expect(Number.isFinite(v)).toBe(true);
  });
});
