/**
 * Test unitaire — Bollinger Bandwidth.
 *
 * Jeu déterministe : closes = [1, 2, 3, 4, 6], length = 3, mult = 2.
 * bandwidth = (upper - lower) / basis = 2·mult·stdev / basis = 4·stdev / basis.
 *
 *   idx 2 : stdev = 0.81649658, basis = 2        -> 4*0.81649658/2 = 1.63299316
 *   idx 4 : stdev = 1.24721913, basis = 4.3333333 -> 4*1.24721913/4.3333333 = 1.15127920
 */

import { describe, it, expect } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { bbBandwidth } from "./bbBandwidth";

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

describe("bbBandwidth", () => {
  const candles = candlesFromCloses([1, 2, 3, 4, 6]);
  const { series } = bbBandwidth.calc(candles, { length: 3, mult: 2 }, ctx);

  it("expose une série alignée sur les bougies", () => {
    expect(Object.keys(series)).toEqual(["bandwidth"]);
    expect(series.bandwidth).toHaveLength(5);
  });

  it("laisse undefined avant la première fenêtre pleine", () => {
    expect(series.bandwidth?.[0]).toBeUndefined();
    expect(series.bandwidth?.[1]).toBeUndefined();
  });

  it("calcule bandwidth exact", () => {
    expect(series.bandwidth?.[2]).toBeCloseTo(1.63299316, 7);
    expect(series.bandwidth?.[4]).toBeCloseTo(1.15127920, 7);
  });

  it("reste >= 0", () => {
    for (const v of series.bandwidth ?? []) {
      if (v !== undefined) expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});
