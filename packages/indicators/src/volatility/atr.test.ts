/**
 * @axiom/indicators — volatility/atr.test.ts
 *
 * Test déterministe de l'ATR de Wilder avec des valeurs attendues CALCULÉES À LA MAIN.
 *
 * On utilise length = 3 pour rendre le lissage RMA traçable à la main.
 *
 * Bougies (high, low, close) :
 *   i=0 : H=10, L=8,  C=9
 *   i=1 : H=12, L=9,  C=11
 *   i=2 : H=11, L=10, C=10
 *   i=3 : H=15, L=11, C=14
 *   i=4 : H=14, L=12, C=13
 *
 * True Range  TR[i] = max(H-L, |H - closePrev|, |L - closePrev|) :
 *   i=0 : première bougie -> H-L = 10-8 = 2
 *   i=1 : closePrev=9  -> max(3, |12-9|=3, |9-9|=0)   = 3
 *   i=2 : closePrev=11 -> max(1, |11-11|=0, |10-11|=1) = 1
 *   i=3 : closePrev=10 -> max(4, |15-10|=5, |11-10|=1) = 5
 *   i=4 : closePrev=14 -> max(2, |14-14|=0, |12-14|=2) = 2
 *
 *   TR = [2, 3, 1, 5, 2]
 *
 * RMA(length=3), amorce = SMA des 3 premières valeurs, placée à l'index 2 :
 *   atr[2] = (2 + 3 + 1) / 3      = 2
 *   atr[3] = 2 + (5 - 2) / 3      = 3
 *   atr[4] = 3 + (2 - 3) / 3      = 8/3 = 2.666666...
 *
 * Les indices 0 et 1 (fenêtre RMA non pleine) restent undefined.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { atr } from "./atr";

/** Construit des bougies à partir de triplets (high, low, close). */
function candlesFromHLC(rows: Array<[high: number, low: number, close: number]>): Candle[] {
  return rows.map(([high, low, close], i) => ({
    time: i * 60_000,
    open: close,
    high,
    low,
    close,
    volume: 0,
  }));
}

describe("ATR (Wilder)", () => {
  it("calcule le régime établi et laisse undefined avant la fenêtre pleine (length=3)", () => {
    const candles = candlesFromHLC([
      [10, 8, 9],
      [12, 9, 11],
      [11, 10, 10],
      [15, 11, 14],
      [14, 12, 13],
    ]);
    const { series } = computeIndicator(atr, candles, { length: 3 });
    const out = series.atr;

    expect(out).toBeDefined();
    if (out === undefined) throw new Error("série atr absente");

    // Démarrage : indices 0 et 1 sans valeur calculable (RMA non amorcée).
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeUndefined();

    // Régime établi (valeurs hand-calc).
    expect(out[2]).toBeCloseTo(2, 9);
    expect(out[3]).toBeCloseTo(3, 9);
    expect(out[4]).toBeCloseTo(2.6666666667, 9);

    // Longueur de sortie alignée sur l'entrée.
    expect(out.length).toBe(candles.length);
  });
});
