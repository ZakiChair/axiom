/**
 * Test unitaire — Standard Deviation.
 *
 * Jeu déterministe : closes = [1, 2, 3, 4, 6], length = 3, population (N).
 * (Mêmes valeurs que la composante `dev` de bollinger.test.ts.)
 *
 *   idx 2 : fenêtre [1,2,3] -> var = (14 - 36/3)/3 = 2/3 -> stdev = 0.81649658
 *   idx 3 : fenêtre [2,3,4] -> var = (29 - 81/3)/3 = 2/3 -> stdev = 0.81649658
 *   idx 4 : fenêtre [3,4,6] -> var = (61 - 169/3)/3      -> stdev = 1.24721913
 */

import { describe, it, expect } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { stddev } from "./stddev";

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

describe("stddev", () => {
  const candles = candlesFromCloses([1, 2, 3, 4, 6]);
  const { series } = stddev.calc(candles, { length: 3 }, ctx);

  it("expose une série alignée sur les bougies", () => {
    expect(Object.keys(series)).toEqual(["stddev"]);
    expect(series.stddev).toHaveLength(5);
  });

  it("laisse undefined avant la première fenêtre pleine", () => {
    expect(series.stddev?.[0]).toBeUndefined();
    expect(series.stddev?.[1]).toBeUndefined();
  });

  it("calcule l'écart-type (population) exact", () => {
    expect(series.stddev?.[2]).toBeCloseTo(0.81649658, 7);
    expect(series.stddev?.[3]).toBeCloseTo(0.81649658, 7);
    expect(series.stddev?.[4]).toBeCloseTo(1.24721913, 7);
  });

  it("reste >= 0", () => {
    for (const v of series.stddev ?? []) {
      if (v !== undefined) expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});
