/**
 * Test unitaire — Donchian Channels.
 *
 * Jeu déterministe (length = 3), high/low explicites :
 *   idx : high, low
 *    0  : 10, 8
 *    1  : 12, 9
 *    2  : 11, 7
 *    3  : 13, 10
 *    4  :  9, 6
 *
 * Valeurs attendues (calcul à la main) :
 *   idx 2 : upper = max(10,12,11) = 12 ; lower = min(8,9,7) = 7  ; basis = 9.5
 *   idx 3 : upper = max(12,11,13) = 13 ; lower = min(9,7,10) = 7 ; basis = 10
 *   idx 4 : upper = max(11,13,9)  = 13 ; lower = min(7,10,6) = 6 ; basis = 9.5
 */

import { describe, it, expect } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { donchian } from "./donchian";

function makeCandles(hl: Array<[number, number]>): Candle[] {
  return hl.map(([high, low], i) => ({
    time: i * 60_000,
    open: (high + low) / 2,
    high,
    low,
    close: (high + low) / 2,
    volume: 0,
  }));
}

const ctx: CalcContext = { hl2: [], hlc3: [], ohlc4: [] };

describe("donchian", () => {
  const candles = makeCandles([
    [10, 8],
    [12, 9],
    [11, 7],
    [13, 10],
    [9, 6],
  ]);
  const { series } = donchian.calc(candles, { length: 3 }, ctx);

  it("expose 3 séries alignées sur les bougies", () => {
    expect(Object.keys(series).sort()).toEqual(["basis", "lower", "upper"]);
    expect(series.basis).toHaveLength(5);
  });

  it("laisse undefined avant la première fenêtre pleine", () => {
    expect(series.upper?.[0]).toBeUndefined();
    expect(series.upper?.[1]).toBeUndefined();
  });

  it("calcule HH / LL / médiane exacts", () => {
    expect(series.upper?.[2]).toBe(12);
    expect(series.lower?.[2]).toBe(7);
    expect(series.basis?.[2]).toBe(9.5);

    expect(series.upper?.[3]).toBe(13);
    expect(series.lower?.[3]).toBe(7);
    expect(series.basis?.[3]).toBe(10);

    expect(series.upper?.[4]).toBe(13);
    expect(series.lower?.[4]).toBe(6);
    expect(series.basis?.[4]).toBe(9.5);
  });
});
