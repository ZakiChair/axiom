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

  it("RSI sur hlc3 diffère de RSI sur close et correspond au calcul sur la série hlc3", () => {
    // OHLC volontairement distincts (high/low asymétriques) pour que hlc3 ≠ close
    // ET que les deltas de hlc3 diffèrent de ceux de close (pas un simple décalage constant).
    const candles: Candle[] = [
      { time: 0, open: 10, high: 10, low: 10, close: 10, volume: 0 },
      { time: 60_000, open: 10, high: 15, low: 9, close: 11, volume: 0 },
      { time: 120_000, open: 11, high: 12, low: 8, close: 10, volume: 0 },
      { time: 180_000, open: 10, high: 16, low: 11, close: 12, volume: 0 },
      { time: 240_000, open: 12, high: 18, low: 10, close: 13, volume: 0 },
      { time: 300_000, open: 13, high: 14, low: 9, close: 12, volume: 0 },
      { time: 360_000, open: 12, high: 20, low: 11, close: 14, volume: 0 },
    ];

    const a = computeIndicator(rsi, candles, { length: 3 });
    const b = computeIndicator(rsi, candles, { length: 3, source: "hlc3" });

    expect(a.series.rsi).not.toEqual(b.series.rsi);

    // hlc3 calculée à la main depuis la fixture ci-dessus, injectée directement
    // dans un contexte de calcul pour obtenir la valeur de référence attendue.
    const hlc3 = candles.map((c) => (c.high + c.low + c.close) / 3);
    const expected = rsi.calc(
      candles,
      { length: 3, source: "hlc3" },
      { hl2: [], hlc3: [], ohlc4: [], source: hlc3 }
    );
    expect(b.series.rsi).toEqual(expected.series.rsi);
  });
});
