/**
 * Test unitaire — Bollinger %B.
 *
 * Jeu déterministe : closes = [1, 2, 3, 4, 6], length = 3, mult = 2.
 * Bandes recalculées comme dans bollinger.test.ts (basis = sma, dev = mult*stdev) :
 *
 *   idx 2 : basis = 2,        lower = 0.36700684, upper = 3.63299316, close = 3
 *           %B = (3 - 0.36700684)/(3.63299316 - 0.36700684) = 0.80618622
 *   idx 4 : basis = 4.3333333, lower = 1.83889508, upper = 6.82777159, close = 6
 *           %B = (6 - 1.83889508)/(6.82777159 - 1.83889508) = 0.83407655
 */

import { describe, it, expect } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { bbPercentB } from "./bbPercentB";

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

const ctx: CalcContext = { hl2: [], hlc3: [], ohlc4: [] };

describe("bbPercentB", () => {
  const candles = candlesFromCloses([1, 2, 3, 4, 6]);
  const { series } = bbPercentB.calc(candles, { length: 3, mult: 2 }, ctx);

  it("expose une série alignée sur les bougies", () => {
    expect(Object.keys(series)).toEqual(["percentB"]);
    expect(series.percentB).toHaveLength(5);
  });

  it("laisse undefined avant la première fenêtre pleine", () => {
    expect(series.percentB?.[0]).toBeUndefined();
    expect(series.percentB?.[1]).toBeUndefined();
  });

  it("calcule %B exact", () => {
    expect(series.percentB?.[2]).toBeCloseTo(0.80618622, 7);
    expect(series.percentB?.[4]).toBeCloseTo(0.83407655, 7);
  });
});
