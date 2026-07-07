/**
 * @axiom/indicators — trend/smma.test.ts
 *
 * SMMA = lissage de Wilder (rma). Amorcée par la SMA des `n` premières clôtures,
 * cette première valeur est EXACTE et vérifiable à la main.
 *
 * closes = [10, 11, 12, 13, 14], length = 3.
 *   idx 0,1 -> undefined
 *   idx 2 -> SMA(10,11,12) = 33/3 = 11   (amorce)
 *   idx 3 -> 11 + (13 − 11)/3 = 11 + 2/3 = 11.6667…
 *   idx 4 -> 11.6667 + (14 − 11.6667)/3 = 11.6667 + 2.3333/3 = 12.4444…
 */

import { describe, expect, it } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { smma } from "./smma";

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

describe("smma (trend, overlay)", () => {
  const candles = candlesFromCloses([10, 11, 12, 13, 14]);

  it("amorce sur la SMA des n premières clôtures", () => {
    const { series } = smma.calc(candles, { length: 3 }, ctx);
    expect(series.smma?.[2]).toBeCloseTo(11, 10);
    expect(series.smma?.[3]).toBeCloseTo(11 + 2 / 3, 10);
  });

  it("amorce undefined avant la première fenêtre pleine", () => {
    const { series } = smma.calc(candles, { length: 3 }, ctx);
    expect(series.smma?.[0]).toBeUndefined();
    expect(series.smma?.[1]).toBeUndefined();
  });

  it("produit une série alignée sur les bougies", () => {
    const { series } = smma.calc(candles, { length: 3 }, ctx);
    expect(series.smma).toHaveLength(candles.length);
  });
});
