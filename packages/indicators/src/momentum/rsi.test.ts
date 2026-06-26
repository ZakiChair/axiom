/**
 * @axiom/indicators — momentum/rsi.test.ts
 *
 * Test déterministe du RSI de Wilder avec des valeurs attendues CALCULÉES À LA MAIN.
 *
 * On utilise length = 3 pour rendre le lissage RMA traçable à la main.
 *
 * Closes : [10, 11, 10, 12, 13, 12, 14]  (index 0..6)
 *
 * Deltas (alignés sur la bougie courante) :
 *   c1: +1  -> gain 1, perte 0
 *   c2: -1  -> gain 0, perte 1
 *   c3: +2  -> gain 2, perte 0
 *   c4: +1  -> gain 1, perte 0
 *   c5: -1  -> gain 0, perte 1
 *   c6: +2  -> gain 2, perte 0
 *
 *   gains  (index j -> bougie j+1) : [1, 0, 2, 1, 0, 2]
 *   pertes                          : [0, 1, 0, 0, 1, 0]
 *
 * RMA(length=3), amorce = SMA des 3 premières valeurs, placée à l'index 2 (bougie 3) :
 *
 *   avgGain : bougie3 = (1+0+2)/3 = 1
 *             bougie4 = 1 + (1-1)/3       = 1
 *             bougie5 = 1 + (0-1)/3       = 2/3
 *             bougie6 = 2/3 + (2-2/3)/3   = 10/9
 *
 *   avgLoss : bougie3 = (0+1+0)/3 = 1/3
 *             bougie4 = 1/3 + (0-1/3)/3   = 2/9
 *             bougie5 = 2/9 + (1-2/9)/3   = 13/27
 *             bougie6 = 13/27 + (0-13/27)/3 = 26/81
 *
 *   RS = avgGain / avgLoss ; RSI = 100 - 100/(1+RS) :
 *     bougie3 : RS = 1 / (1/3)      = 3      -> RSI = 100 - 100/4      = 75
 *     bougie4 : RS = 1 / (2/9)      = 4.5    -> RSI = 100 - 100/5.5    = 81.818181...
 *     bougie5 : RS = (2/3)/(13/27)  = 18/13  -> RSI = 100 - 1300/31    = 58.064516...
 *     bougie6 : RS = (10/9)/(26/81) = 45/13  -> RSI = 100 - 1300/58    = 77.586206...
 *
 * Les bougies 0,1,2 (index < length) restent undefined (fenêtre RMA non pleine).
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { rsi } from "./rsi";

/** Construit des bougies minimales à partir des seuls prix de clôture. */
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

describe("RSI (Wilder)", () => {
  it("calcule le régime établi et laisse undefined avant la fenêtre pleine (length=3)", () => {
    const candles = candlesFromCloses([10, 11, 10, 12, 13, 12, 14]);
    const { series } = computeIndicator(rsi, candles, { length: 3 });
    const out = series.rsi;

    expect(out).toBeDefined();
    if (out === undefined) throw new Error("série rsi absente");

    // Démarrage : indices 0,1,2 sans valeur calculable.
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeUndefined();
    expect(out[2]).toBeUndefined();

    // Régime établi (valeurs hand-calc).
    expect(out[3]).toBeCloseTo(75, 9);
    expect(out[4]).toBeCloseTo(81.8181818182, 9);
    expect(out[5]).toBeCloseTo(58.0645161290, 9);
    expect(out[6]).toBeCloseTo(77.5862068966, 9);

    // Longueur de sortie alignée sur l'entrée.
    expect(out.length).toBe(candles.length);
  });

  it("renvoie 100 quand avgLoss == 0 (hausse stricte)", () => {
    const candles = candlesFromCloses([1, 2, 3, 4, 5]);
    const { series } = computeIndicator(rsi, candles, { length: 3 });
    const out = series.rsi;
    if (out === undefined) throw new Error("série rsi absente");

    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeUndefined();
    expect(out[2]).toBeUndefined();
    // Aucune perte sur la fenêtre -> RSI saturé à 100.
    expect(out[3]).toBe(100);
    expect(out[4]).toBe(100);
  });
});
