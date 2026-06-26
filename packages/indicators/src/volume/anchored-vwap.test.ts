/**
 * @axiom/indicators — volume/anchored-vwap.test.ts
 *
 * Test déterministe de l'Anchored VWAP avec des valeurs CALCULÉES À LA MAIN.
 *
 * Pour rendre le prix typique trivial, on pose high = low = close = prix,
 * d'où tp = hlc3 = (prix + prix + prix) / 3 = prix.
 *
 * Bougies (prix, volume) :
 *   i=0 : prix=10, vol=5
 *   i=1 : prix=20, vol=5
 *   i=2 : prix=10, vol=10   <- ancrage (anchorIndex = 2)
 *   i=3 : prix=20, vol=30
 *   i=4 : prix=15, vol=10
 *
 * Avec anchorIndex = 2, cumul depuis i=2 :
 *   i=2 : cumTPV = 10*10 = 100 ; cumVol = 10        -> 100/10  = 10
 *   i=3 : cumTPV = 100 + 20*30 = 700 ; cumVol = 40  -> 700/40  = 17.5
 *   i=4 : cumTPV = 700 + 15*10 = 850 ; cumVol = 50  -> 850/50  = 17
 *   Indices 0 et 1 (avant l'ancrage) : undefined.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { anchoredVwap } from "./anchored-vwap";

/** Construit des bougies à partir de couples (prix, volume) — high=low=close=prix. */
function candlesFromPriceVol(rows: Array<[price: number, volume: number]>): Candle[] {
  return rows.map(([price, volume], i) => ({
    time: i * 60_000,
    open: price,
    high: price,
    low: price,
    close: price,
    volume,
  }));
}

describe("Anchored VWAP", () => {
  it("cumule depuis l'index d'ancrage et laisse undefined avant (anchorIndex=2)", () => {
    const candles = candlesFromPriceVol([
      [10, 5],
      [20, 5],
      [10, 10],
      [20, 30],
      [15, 10],
    ]);
    const { series } = computeIndicator(anchoredVwap, candles, { anchorIndex: 2 });
    const out = series.anchoredVwap;

    expect(out).toBeDefined();
    if (out === undefined) throw new Error("série anchoredVwap absente");

    // Avant l'ancrage : aucune valeur.
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeUndefined();

    // Depuis l'ancrage (valeurs hand-calc).
    expect(out[2]).toBeCloseTo(10, 9);
    expect(out[3]).toBeCloseTo(17.5, 9);
    expect(out[4]).toBeCloseTo(17, 9);

    expect(out.length).toBe(candles.length);
  });

  it("ancre par défaut à l'index 0 (cumul sur tout le jeu)", () => {
    const candles = candlesFromPriceVol([
      [10, 10],
      [20, 10],
    ]);
    const { series } = computeIndicator(anchoredVwap, candles);
    const out = series.anchoredVwap;
    if (out === undefined) throw new Error("série anchoredVwap absente");

    // i=0 : 10*10 / 10 = 10 ; i=1 : (100 + 200) / 20 = 15.
    expect(out[0]).toBeCloseTo(10, 9);
    expect(out[1]).toBeCloseTo(15, 9);
  });

  it("reste undefined tant que le volume cumulé est nul depuis l'ancrage", () => {
    const candles = candlesFromPriceVol([
      [10, 0],
      [20, 10],
    ]);
    const { series } = computeIndicator(anchoredVwap, candles, { anchorIndex: 0 });
    const out = series.anchoredVwap;
    if (out === undefined) throw new Error("série anchoredVwap absente");

    // Aucun volume cumulé en i=0 -> undefined ; en i=1 le volume apparaît.
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeCloseTo(20, 9);
  });
});
