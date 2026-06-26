/**
 * @axiom/indicators — trend/macd.test.ts
 *
 * Test déterministe du MACD avec des paramètres réduits (fast=1, slow=3, signal=3)
 * choisis pour donner des valeurs entières/décimales propres, calculées À LA MAIN.
 *
 * ─── Données ────────────────────────────────────────────────────────────────
 * closes = [2, 4, 6, 8, 4, 9, 3, 11]   (n = 8)
 *
 * ─── EMA rapide (fast = 1) ──────────────────────────────────────────────────
 * ema(_, 1) = identité → fastEma = close = [2, 4, 6, 8, 4, 9, 3, 11]
 *
 * ─── EMA lente (slow = 3, k = 2/(3+1) = 0.5) ───────────────────────────────
 * amorce à l'index 2 = SMA des 3 premiers = (2+4+6)/3 = 4
 *   i3 : 0.5*8 + 0.5*4 = 6
 *   i4 : 0.5*4 + 0.5*6 = 5
 *   i5 : 0.5*9 + 0.5*5 = 7
 *   i6 : 0.5*3 + 0.5*7 = 5
 *   i7 : 0.5*11 + 0.5*5 = 8
 * slowEma = [u, u, 4, 6, 5, 7, 5, 8]
 *
 * ─── Ligne MACD (fast - slow, définie dès l'index 2) ───────────────────────
 *   i2 : 6-4 = 2
 *   i3 : 8-6 = 2
 *   i4 : 4-5 = -1
 *   i5 : 9-7 = 2
 *   i6 : 3-5 = -2
 *   i7 : 11-8 = 3
 * macd = [u, u, 2, 2, -1, 2, -2, 3]
 *
 * ─── Ligne signal (EMA signal=3 sur les valeurs DÉFINIES du MACD) ──────────
 * valeurs compactées = [2, 2, -1, 2, -2, 3]
 * amorce (index compact 2) = (2+2-1)/3 = 1
 *   compact i3 : 0.5*2  + 0.5*1     = 1.5
 *   compact i4 : 0.5*(-2)+ 0.5*1.5  = -0.25
 *   compact i5 : 0.5*3  + 0.5*(-0.25)= 1.375
 * signalCompact = [u, u, 1, 1.5, -0.25, 1.375]
 * ré-aligné sur les index d'origine [2,3,4,5,6,7] :
 * signal = [u, u, u, u, 1, 1.5, -0.25, 1.375]
 *
 * ─── Histogramme (macd - signal, défini dès l'index 4) ─────────────────────
 *   i4 : -1 - 1      = -2
 *   i5 :  2 - 1.5    = 0.5
 *   i6 : -2 - (-0.25)= -1.75
 *   i7 :  3 - 1.375  = 1.625
 * hist = [u, u, u, u, -2, 0.5, -1.75, 1.625]
 */

import { describe, expect, it } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { macd } from "./macd";

/** Construit des bougies à partir des seules clôtures (le calcul n'utilise que close). */
function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((c, i) => ({
    time: i * 60_000,
    open: c,
    high: c,
    low: c,
    close: c,
    volume: 0,
  }));
}

// Le calcul MACD n'utilise pas le contexte ; un contexte vide suffit.
const emptyCtx: CalcContext = { hl2: [], hlc3: [], ohlc4: [] };

describe("MACD", () => {
  it("calcule macd/signal/hist en régime établi et garde les undefined au démarrage", () => {
    const candles = candlesFromCloses([2, 4, 6, 8, 4, 9, 3, 11]);
    const { series } = macd.calc(
      candles,
      { fast: 1, slow: 3, signal: 3 },
      emptyCtx
    );

    // Ligne MACD : undefined avant l'index 2, puis valeurs calculées à la main.
    expect(series.macd).toEqual([
      undefined,
      undefined,
      2,
      2,
      -1,
      2,
      -2,
      3,
    ]);

    // Ligne signal : undefined avant l'index 4 (démarrage MACD + démarrage EMA signal).
    expect(series.signal).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      1,
      1.5,
      -0.25,
      1.375,
    ]);

    // Histogramme : défini dès l'index 4.
    expect(series.hist).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      -2,
      0.5,
      -1.75,
      1.625,
    ]);
  });

  it("renvoie tout en undefined tant que la fenêtre n'est pas pleine (defaults 12/26/9)", () => {
    // 5 bougies < slow(26) : aucune EMA lente, donc aucune valeur MACD calculable.
    const candles = candlesFromCloses([1, 2, 3, 4, 5]);
    const { series } = macd.calc(candles, {}, emptyCtx);

    const allUndef = (arr: Array<number | undefined>) =>
      arr.length === 5 && arr.every((v) => v === undefined);

    expect(allUndef(series.macd ?? [])).toBe(true);
    expect(allUndef(series.signal ?? [])).toBe(true);
    expect(allUndef(series.hist ?? [])).toBe(true);
  });
});
