import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { stratSpotBreakout } from "./stratSpotBreakout";

function makeCandle(close: number, buy: number, sell: number): Candle {
  return {
    time: 1000,
    open: close - 1,
    high: close + 1,
    low: close - 2,
    close,
    volume: buy + sell,
    buyVolume: buy,
    sellVolume: sell,
  };
}

describe("stratSpotBreakout", () => {
  it("déclenche un signal long si breakout Donchian et fort Taker Net", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 15; i++) {
      candles.push(makeCandle(100, 50, 50));
    }
    // Bougie 15 : Breakout au-dessus de 101 avec fort buy volume (80 vs 20 -> net 60%)
    candles.push(makeCandle(105, 80, 20));
    // Bougies suivantes pour que la transition ne soit pas sur la dernière bougie
    for (let i = 0; i < 5; i++) {
      candles.push(makeCandle(105, 50, 50));
    }

    const res = computeIndicator(stratSpotBreakout, candles, { canal: 10, seuilNet: 20 }, {});
    expect(res.annotations).toBeDefined();
    expect(res.annotations?.marqueurs).toBeDefined();
    expect(res.annotations!.marqueurs!.length).toBeGreaterThan(0);
  });

  it("ne confirme aucun breakout quand le split acheteur/vendeur est absent", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 15; i++) candles.push(makeCandle(100, 50, 50));
    candles.push({
      time: 2000,
      open: 100,
      high: 106,
      low: 99,
      close: 105,
      volume: 1,
    });
    for (let i = 0; i < 5; i++) candles.push(makeCandle(105, 50, 50));

    const res = computeIndicator(stratSpotBreakout, candles, { canal: 10, seuilNet: 20 });

    expect(res.series.prixEntree).toEqual(new Array(candles.length).fill(undefined));
    expect(res.annotations).toBeUndefined();
  });

  it.each([
    [Number.NaN, 1, "achat NaN"],
    [1, Number.POSITIVE_INFINITY, "vente infinie"],
    [-1, 2, "achat négatif"],
    [2, -1, "vente négative"],
    [0, 0, "somme nulle"],
  ])("ne confirme pas un breakout avec un split invalide : %s / %s (%s)", (buy, sell) => {
    const candles: Candle[] = [];
    for (let i = 0; i < 15; i++) candles.push(makeCandle(100, 50, 50));
    candles.push(makeCandle(105, buy, sell));
    for (let i = 0; i < 5; i++) candles.push(makeCandle(105, 50, 50));

    const res = computeIndicator(stratSpotBreakout, candles, { canal: 10, seuilNet: 20 });

    expect(res.series.prixEntree).toEqual(new Array(candles.length).fill(undefined));
    expect(res.annotations).toBeUndefined();
  });
});
