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

/** Contexte minimal (non utilisé par SMA, mais requis par la signature). */
const ctx: CalcContext = { hl2: [], hlc3: [], ohlc4: [] };

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
});
