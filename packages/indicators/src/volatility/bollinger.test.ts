/**
 * Test unitaire — Bollinger Bands.
 *
 * Jeu déterministe : closes = [1, 2, 3, 4, 6], length = 3, mult = 2.
 * stdev en convention population (divise par N = 3), comme TradingView.
 *
 * Calcul à la main (basis = sma, dev = mult * stdev, upper/lower = basis ± dev) :
 *
 *  idx 0, 1 : fenêtre incomplète          -> undefined partout
 *
 *  idx 2 : fenêtre [1, 2, 3]
 *    basis = (1+2+3)/3 = 2
 *    var   = ((1²+2²+3²) - (1+2+3)²/3)/3 = (14 - 12)/3 = 2/3
 *    stdev = √(2/3)                       = 0.8164966
 *    dev   = 2 * 0.8164966               = 1.6329932
 *    upper = 2 + 1.6329932               = 3.6329932
 *    lower = 2 - 1.6329932               = 0.3670068
 *
 *  idx 3 : fenêtre [2, 3, 4]
 *    basis = (2+3+4)/3 = 3
 *    var   = (29 - 81/3)/3 = (29 - 27)/3 = 2/3
 *    stdev = 0.8164966
 *    dev   = 1.6329932
 *    upper = 4.6329932
 *    lower = 1.3670068
 *
 *  idx 4 : fenêtre [3, 4, 6]
 *    basis = (3+4+6)/3 = 13/3 = 4.3333333
 *    var   = (61 - 169/3)/3 = (4.6666667)/3 = 1.5555556
 *    stdev = √1.5555556 = 1.2472191
 *    dev   = 2.4944383
 *    upper = 4.3333333 + 2.4944383 = 6.8277716
 *    lower = 4.3333333 - 2.4944383 = 1.8388950
 */

import { describe, it, expect } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { computeIndicator } from "../engine";
import { bollinger } from "./bollinger";

/** Construit des bougies minimales à partir de prix de clôture. */
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

/** Contexte minimal : source = close (mêmes valeurs que la fixture ci-dessous). */
const ctx: CalcContext = {
  hl2: [],
  hlc3: [],
  ohlc4: [],
  source: [1, 2, 3, 4, 6],
};

describe("bollinger", () => {
  const candles = candlesFromCloses([1, 2, 3, 4, 6]);
  const { series } = bollinger.calc(candles, { length: 3, mult: 2 }, ctx);

  it("expose les trois séries de sortie alignées sur les bougies", () => {
    expect(Object.keys(series).sort()).toEqual(["basis", "lower", "upper"]);
    expect(series.basis).toHaveLength(5);
    expect(series.upper).toHaveLength(5);
    expect(series.lower).toHaveLength(5);
  });

  it("laisse undefined avant la première fenêtre pleine (length - 1)", () => {
    for (const key of ["basis", "upper", "lower"] as const) {
      expect(series[key]?.[0]).toBeUndefined();
      expect(series[key]?.[1]).toBeUndefined();
    }
  });

  it("calcule basis = sma(close, length)", () => {
    expect(series.basis?.[2]).toBeCloseTo(2, 10);
    expect(series.basis?.[3]).toBeCloseTo(3, 10);
    expect(series.basis?.[4]).toBeCloseTo(4.3333333, 6);
  });

  it("calcule upper = basis + mult * stdev(pop)", () => {
    expect(series.upper?.[2]).toBeCloseTo(3.6329932, 6);
    expect(series.upper?.[3]).toBeCloseTo(4.6329932, 6);
    expect(series.upper?.[4]).toBeCloseTo(6.8277716, 6);
  });

  it("calcule lower = basis - mult * stdev(pop)", () => {
    expect(series.lower?.[2]).toBeCloseTo(0.3670068, 6);
    expect(series.lower?.[3]).toBeCloseTo(1.3670068, 6);
    expect(series.lower?.[4]).toBeCloseTo(1.8388950, 6);
  });

  it("Bollinger sur hlc3 diffère de Bollinger sur close et correspond au calcul sur la série hlc3", () => {
    const ohlcCandles: Candle[] = [
      { time: 0, open: 10, high: 10, low: 10, close: 10, volume: 0 },
      { time: 60_000, open: 10, high: 15, low: 9, close: 11, volume: 0 },
      { time: 120_000, open: 11, high: 12, low: 8, close: 10, volume: 0 },
      { time: 180_000, open: 10, high: 16, low: 11, close: 12, volume: 0 },
      { time: 240_000, open: 12, high: 18, low: 10, close: 13, volume: 0 },
      { time: 300_000, open: 13, high: 14, low: 9, close: 12, volume: 0 },
      { time: 360_000, open: 12, high: 20, low: 11, close: 14, volume: 0 },
    ];
    const params = { length: 3, mult: 2 };

    const a = computeIndicator(bollinger, ohlcCandles, params);
    const b = computeIndicator(bollinger, ohlcCandles, { ...params, source: "hlc3" });

    expect(a.series.basis).not.toEqual(b.series.basis);

    const hlc3 = ohlcCandles.map((c) => (c.high + c.low + c.close) / 3);
    const expected = bollinger.calc(
      ohlcCandles,
      { ...params, source: "hlc3" },
      { hl2: [], hlc3: [], ohlc4: [], source: hlc3 }
    );
    expect(b.series.basis).toEqual(expected.series.basis);
    expect(b.series.upper).toEqual(expected.series.upper);
    expect(b.series.lower).toEqual(expected.series.lower);
  });
});
