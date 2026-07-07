/**
 * @axiom/indicators — trend/sma.test.ts
 *
 * Test déterministe de l'indicateur SMA.
 *
 * Jeu de bougies : closes = [10, 11, 12, 13, 14], length = 3.
 * Formule SMA(n) = moyenne des n dernières clôtures.
 *
 * Calcul à la main (length = 3) :
 *   idx 0 (close 10) -> fenêtre incomplète           -> undefined
 *   idx 1 (close 11) -> fenêtre incomplète           -> undefined
 *   idx 2 (close 12) -> (10 + 11 + 12) / 3 = 33 / 3  -> 11
 *   idx 3 (close 13) -> (11 + 12 + 13) / 3 = 36 / 3  -> 12
 *   idx 4 (close 14) -> (12 + 13 + 14) / 3 = 39 / 3  -> 13
 */

import { describe, expect, it } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { computeIndicator } from "../engine";
import { sma } from "./sma";

/** Fabrique des bougies minimales à partir d'une liste de clôtures. */
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

/** Contexte minimal : source = close (mêmes valeurs que la fixture ci-dessous). */
const ctx: CalcContext = {
  hl2: [],
  hlc3: [],
  ohlc4: [],
  source: [10, 11, 12, 13, 14],
};

describe("sma (trend, overlay)", () => {
  it("calcule la moyenne mobile en régime établi", () => {
    const candles = candlesFromCloses([10, 11, 12, 13, 14]);
    const { series } = sma.calc(candles, { length: 3 }, ctx);

    expect(series.sma?.[2]).toBe(11);
    expect(series.sma?.[3]).toBe(12);
    expect(series.sma?.[4]).toBe(13);
  });

  it("laisse undefined avant la première fenêtre pleine", () => {
    const candles = candlesFromCloses([10, 11, 12, 13, 14]);
    const { series } = sma.calc(candles, { length: 3 }, ctx);

    expect(series.sma?.[0]).toBeUndefined();
    expect(series.sma?.[1]).toBeUndefined();
  });

  it("produit une série alignée sur les bougies", () => {
    const candles = candlesFromCloses([10, 11, 12, 13, 14]);
    const { series } = sma.calc(candles, { length: 3 }, ctx);

    expect(series.sma).toHaveLength(candles.length);
  });

  it("SMA sur hlc3 diffère de SMA sur close et correspond au calcul sur la série hlc3", () => {
    // OHLC volontairement distincts (high/low asymétriques) pour que hlc3 ≠ close
    // ET que les deltas de hlc3 diffèrent de ceux de close.
    const ohlcCandles: Candle[] = [
      { time: 0, open: 10, high: 10, low: 10, close: 10, volume: 0 },
      { time: 60_000, open: 10, high: 15, low: 9, close: 11, volume: 0 },
      { time: 120_000, open: 11, high: 12, low: 8, close: 10, volume: 0 },
      { time: 180_000, open: 10, high: 16, low: 11, close: 12, volume: 0 },
      { time: 240_000, open: 12, high: 18, low: 10, close: 13, volume: 0 },
      { time: 300_000, open: 13, high: 14, low: 9, close: 12, volume: 0 },
      { time: 360_000, open: 12, high: 20, low: 11, close: 14, volume: 0 },
    ];

    const a = computeIndicator(sma, ohlcCandles, { length: 3 });
    const b = computeIndicator(sma, ohlcCandles, { length: 3, source: "hlc3" });

    expect(a.series.sma).not.toEqual(b.series.sma);

    const hlc3 = ohlcCandles.map((c) => (c.high + c.low + c.close) / 3);
    const expected = sma.calc(
      ohlcCandles,
      { length: 3, source: "hlc3" },
      { hl2: [], hlc3: [], ohlc4: [], source: hlc3 }
    );
    expect(b.series.sma).toEqual(expected.series.sma);
  });
});
