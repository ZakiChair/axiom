/**
 * @axiom/indicators — trend/wma.test.ts
 *
 * Test déterministe de la WMA (indicateur linéaire -> valeur EXACTE à la main).
 *
 * closes = [10, 11, 12, 13, 14], length = 3, Σpoids = 1+2+3 = 6.
 *   idx 0,1 -> fenêtre incomplète -> undefined
 *   idx 2 -> (10·1 + 11·2 + 12·3) / 6 = (10 + 22 + 36) / 6 = 68/6 = 11.3333…
 *   idx 3 -> (11·1 + 12·2 + 13·3) / 6 = (11 + 24 + 39) / 6 = 74/6 = 12.3333…
 *   idx 4 -> (12·1 + 13·2 + 14·3) / 6 = (12 + 26 + 42) / 6 = 80/6 = 13.3333…
 */

import { describe, expect, it } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { computeIndicator } from "../engine";
import { wma } from "./wma";

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

const ctx: CalcContext = {
  hl2: [],
  hlc3: [],
  ohlc4: [],
  source: [10, 11, 12, 13, 14],
};

describe("wma (trend, overlay)", () => {
  const candles = candlesFromCloses([10, 11, 12, 13, 14]);

  it("calcule la moyenne pondérée exacte", () => {
    const { series } = wma.calc(candles, { length: 3 }, ctx);
    expect(series.wma?.[2]).toBeCloseTo(68 / 6, 10);
    expect(series.wma?.[3]).toBeCloseTo(74 / 6, 10);
    expect(series.wma?.[4]).toBeCloseTo(80 / 6, 10);
  });

  it("amorce undefined avant la première fenêtre pleine", () => {
    const { series } = wma.calc(candles, { length: 3 }, ctx);
    expect(series.wma?.[0]).toBeUndefined();
    expect(series.wma?.[1]).toBeUndefined();
  });

  it("produit une série alignée sur les bougies", () => {
    const { series } = wma.calc(candles, { length: 3 }, ctx);
    expect(series.wma).toHaveLength(candles.length);
  });

  it("WMA sur hlc3 diffère de WMA sur close et correspond au calcul sur la série hlc3", () => {
    const ohlcCandles: Candle[] = [
      { time: 0, open: 10, high: 10, low: 10, close: 10, volume: 0 },
      { time: 60_000, open: 10, high: 15, low: 9, close: 11, volume: 0 },
      { time: 120_000, open: 11, high: 12, low: 8, close: 10, volume: 0 },
      { time: 180_000, open: 10, high: 16, low: 11, close: 12, volume: 0 },
      { time: 240_000, open: 12, high: 18, low: 10, close: 13, volume: 0 },
      { time: 300_000, open: 13, high: 14, low: 9, close: 12, volume: 0 },
      { time: 360_000, open: 12, high: 20, low: 11, close: 14, volume: 0 },
    ];

    const a = computeIndicator(wma, ohlcCandles, { length: 3 });
    const b = computeIndicator(wma, ohlcCandles, { length: 3, source: "hlc3" });

    expect(a.series.wma).not.toEqual(b.series.wma);

    const hlc3 = ohlcCandles.map((c) => (c.high + c.low + c.close) / 3);
    const expected = wma.calc(
      ohlcCandles,
      { length: 3, source: "hlc3" },
      { hl2: [], hlc3: [], ohlc4: [], source: hlc3 }
    );
    expect(b.series.wma).toEqual(expected.series.wma);
  });
});
