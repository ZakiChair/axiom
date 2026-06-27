/**
 * @axiom/indicators — trend/vwma.test.ts
 *
 * Test déterministe de la VWMA (indicateur linéaire -> valeur EXACTE à la main).
 *
 * closes = [10, 11, 12], volumes = [1, 2, 3], length = 2.
 *   idx 0 -> fenêtre incomplète -> undefined
 *   idx 1 -> (10·1 + 11·2) / (1 + 2) = (10 + 22) / 3 = 32/3 = 10.6667…
 *   idx 2 -> (11·2 + 12·3) / (2 + 3) = (22 + 36) / 5 = 58/5 = 11.6
 */

import { describe, expect, it } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { vwma } from "./vwma";

function candles(closes: number[], volumes: number[]): Candle[] {
  return closes.map((close, i) => ({
    time: i * 60_000,
    open: close,
    high: close,
    low: close,
    close,
    volume: volumes[i] ?? 0,
  }));
}

const ctx: CalcContext = { hl2: [], hlc3: [], ohlc4: [] };

describe("vwma (trend, overlay)", () => {
  const data = candles([10, 11, 12], [1, 2, 3]);

  it("calcule la moyenne pondérée par le volume (exacte)", () => {
    const { series } = vwma.calc(data, { length: 2 }, ctx);
    expect(series.vwma?.[1]).toBeCloseTo(32 / 3, 10);
    expect(series.vwma?.[2]).toBeCloseTo(58 / 5, 10);
  });

  it("amorce undefined avant la première fenêtre pleine", () => {
    const { series } = vwma.calc(data, { length: 2 }, ctx);
    expect(series.vwma?.[0]).toBeUndefined();
  });

  it("produit une série alignée sur les bougies", () => {
    const { series } = vwma.calc(data, { length: 2 }, ctx);
    expect(series.vwma).toHaveLength(data.length);
  });
});
