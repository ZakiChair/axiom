import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { takerNetPct } from "./takerNetPct";

function makeCandle(buy: number, sell: number): Candle {
  return {
    time: 1000,
    open: 100,
    high: 105,
    low: 95,
    close: 102,
    volume: buy + sell,
    buyVolume: buy,
    sellVolume: sell,
  };
}

describe("takerNetPct", () => {
  it("calcule le pourcentage net acheteur / vendeur", () => {
    const candles = [
      makeCandle(75, 25), // (75 - 25) / 100 * 100 = +50%
      makeCandle(20, 80), // (20 - 80) / 100 * 100 = -60%
      makeCandle(50, 50), // 0%
    ];

    const res = computeIndicator(takerNetPct, candles, { emaLength: 2 });
    expect(res.series.net).toBeDefined();
    expect(res.series.net![0]).toBeCloseTo(50, 4);
    expect(res.series.net![1]).toBeCloseTo(-60, 4);
    expect(res.series.net![2]).toBeCloseTo(0, 4);
  });

  it("ne fabrique aucun flux depuis la couleur quand le split est absent", () => {
    const candles: Candle[] = [
      { time: 1000, open: 100, high: 100, low: 100, close: 100, volume: 1 },
    ];

    const res = computeIndicator(takerNetPct, candles, { emaLength: 1 });

    expect(res.series.net).toEqual([undefined]);
    expect(res.series.signal).toEqual([undefined]);
  });

  it.each([
    [Number.NaN, 1, "achat NaN"],
    [1, Number.POSITIVE_INFINITY, "vente infinie"],
    [-1, 2, "achat négatif"],
    [2, -1, "vente négative"],
    [0, 0, "somme nulle"],
  ])("ignore un split invalide : %s / %s (%s)", (buyVolume, sellVolume) => {
    const candle = makeCandle(buyVolume, sellVolume);

    const res = computeIndicator(takerNetPct, [candle], { emaLength: 1 });

    expect(res.series.net).toEqual([undefined]);
    expect(res.series.signal).toEqual([undefined]);
  });

  it("lisse seulement les splits réels puis reprojette le signal sur leurs index", () => {
    const sansSplit: Candle = {
      time: 2000,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      volume: 1,
    };
    const candles = [
      makeCandle(75, 25),
      sansSplit,
      makeCandle(25, 75),
      makeCandle(100, 0),
    ];

    const res = computeIndicator(takerNetPct, candles, { emaLength: 2 });

    expect(res.series.net).toEqual([50, undefined, -50, 100]);
    expect(res.series.signal![0]).toBeUndefined();
    expect(res.series.signal![1]).toBeUndefined();
    expect(res.series.signal![2]).toBeCloseTo(0, 8);
    expect(res.series.signal![3]).toBeCloseTo(66.66666667, 8);
  });
});
