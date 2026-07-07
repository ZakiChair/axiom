/**
 * Test unitaire — Envelopes.
 *
 * Jeu déterministe : closes = [1, 2, 3, 4, 6], length = 3, percent = 1 (%).
 *   idx 2 : basis = 2          ; upper = 2 * 1.01 = 2.02   ; lower = 1.98
 *   idx 3 : basis = 3          ; upper = 3.03              ; lower = 2.97
 *   idx 4 : basis = 13/3       ; upper = 4.33333*1.01      ; lower = 4.33333*0.99
 *         = 4.3333333          ; = 4.3766667              ; = 4.29
 */

import { describe, it, expect } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { envelopes } from "./envelopes";

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

const ctx: CalcContext = { hl2: [], hlc3: [], ohlc4: [], source: [] };

describe("envelopes", () => {
  const candles = candlesFromCloses([1, 2, 3, 4, 6]);
  const { series } = envelopes.calc(candles, { length: 3, percent: 1 }, ctx);

  it("expose 3 séries alignées sur les bougies", () => {
    expect(Object.keys(series).sort()).toEqual(["basis", "lower", "upper"]);
    expect(series.basis).toHaveLength(5);
  });

  it("laisse undefined avant la première fenêtre pleine", () => {
    expect(series.basis?.[1]).toBeUndefined();
  });

  it("calcule basis et bandes ±1% exacts", () => {
    expect(series.basis?.[2]).toBeCloseTo(2, 10);
    expect(series.upper?.[2]).toBeCloseTo(2.02, 10);
    expect(series.lower?.[2]).toBeCloseTo(1.98, 10);

    expect(series.basis?.[4]).toBeCloseTo(4.3333333, 6);
    expect(series.upper?.[4]).toBeCloseTo(4.3766667, 6);
    expect(series.lower?.[4]).toBeCloseTo(4.29, 6);
  });
});
