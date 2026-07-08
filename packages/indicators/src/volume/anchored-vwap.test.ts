/**
 * @axiom/indicators — volume/anchored-vwap.test.ts
 *
 * Test déterministe de l'Anchored VWAP avec des valeurs CALCULÉES À LA MAIN.
 *
 * Pour rendre le prix typique trivial, on pose high = low = close = prix,
 * d'où tp = hlc3 = (prix + prix + prix) / 3 = prix.
 *
 * L'ancrage se fait désormais par TIMESTAMP (`anchorTime`, ms) : le calc démarre
 * son cumul à la PREMIÈRE bougie dont `time >= anchorTime` (survit à un backfill,
 * contrairement à un ancrage par index). `anchorTime = 0` (défaut) = depuis le début.
 *
 * Bougies (prix, volume) — time = i * 60 000 ms :
 *   i=0 : time=0       prix=10, vol=5
 *   i=1 : time=60 000  prix=20, vol=5
 *   i=2 : time=120 000 prix=10, vol=10   <- 3e bougie
 *   i=3 : time=180 000 prix=20, vol=30
 *   i=4 : time=240 000 prix=15, vol=10
 *
 * Ancré à la 3e bougie (anchorTime = 120 000, équivalent de l'ancien index 2) :
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

/** Fixture partagée (5 bougies, cf. en-tête). */
function fixture(): Candle[] {
  return candlesFromPriceVol([
    [10, 5],
    [20, 5],
    [10, 10],
    [20, 30],
    [15, 10],
  ]);
}

describe("Anchored VWAP", () => {
  it("ancre au timestamp de la 3e bougie (anchorTime=120 000) et laisse undefined avant", () => {
    const candles = fixture();
    // time de la 3e bougie = 120 000 : équivaut à l'ancien anchorIndex = 2.
    const { series } = computeIndicator(anchoredVwap, candles, { anchorTime: 120_000 });
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

  it("ancre sur la bougie SUIVANTE quand anchorTime tombe entre deux bougies", () => {
    const candles = fixture();
    // 90 000 est entre i=1 (60 000) et i=2 (120 000) : première bougie >= 90 000 = i=2.
    const { series } = computeIndicator(anchoredVwap, candles, { anchorTime: 90_000 });
    const out = series.anchoredVwap;
    if (out === undefined) throw new Error("série anchoredVwap absente");

    // Ancrage effectif à i=2 → mêmes valeurs que le cas précédent.
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeUndefined();
    expect(out[2]).toBeCloseTo(10, 9);
    expect(out[3]).toBeCloseTo(17.5, 9);
    expect(out[4]).toBeCloseTo(17, 9);
  });

  it("ancre par défaut à 0 (cumul complet sur tout le jeu)", () => {
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
    const { series } = computeIndicator(anchoredVwap, candles, { anchorTime: 0 });
    const out = series.anchoredVwap;
    if (out === undefined) throw new Error("série anchoredVwap absente");

    // Aucun volume cumulé en i=0 -> undefined ; en i=1 le volume apparaît.
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeCloseTo(20, 9);
  });

  it("compat : un ancien paramètre persisté `anchorIndex` est ignoré (repli sur le défaut 0)", () => {
    const candles = fixture();
    // `anchorIndex` n'existe plus : il ne doit PAS ancrer à l'index 2. Le calc lit
    // uniquement `anchorTime` (absent ici → défaut 0) → cumul complet depuis i=0.
    const { series } = computeIndicator(anchoredVwap, candles, {
      anchorIndex: 2,
    } as unknown as Record<string, number>);
    const out = series.anchoredVwap;
    if (out === undefined) throw new Error("série anchoredVwap absente");

    // Cumul complet (hand-calc) : preuve que l'ancrage à l'index 2 est ignoré
    // (sinon out[0] serait undefined).
    //   i=0 : 50 / 5 = 10 ; i=2 : 250 / 20 = 12.5 ; i=4 : 1000 / 60 = 16.6667.
    expect(out[0]).toBeCloseTo(10, 9);
    expect(out[2]).toBeCloseTo(12.5, 9);
    expect(out[4]).toBeCloseTo(1000 / 60, 9);
  });
});
