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
import { computeIndicator } from "../engine";
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

/** Construit un contexte minimal avec source = close (fixtures à clôtures constantes O=H=L=C). */
function ctxFromCloses(closes: number[]): CalcContext {
  return { hl2: [], hlc3: [], ohlc4: [], source: closes };
}

describe("MACD", () => {
  it("calcule macd/signal/hist en régime établi et garde les undefined au démarrage", () => {
    const closes = [2, 4, 6, 8, 4, 9, 3, 11];
    const candles = candlesFromCloses(closes);
    const { series } = macd.calc(
      candles,
      { fast: 1, slow: 3, signal: 3 },
      ctxFromCloses(closes)
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
    const closes = [1, 2, 3, 4, 5];
    const candles = candlesFromCloses(closes);
    const { series } = macd.calc(candles, {}, ctxFromCloses(closes));

    const allUndef = (arr: Array<number | undefined>) =>
      arr.length === 5 && arr.every((v) => v === undefined);

    expect(allUndef(series.macd ?? [])).toBe(true);
    expect(allUndef(series.signal ?? [])).toBe(true);
    expect(allUndef(series.hist ?? [])).toBe(true);
  });

  it("MACD sur hlc3 diffère de MACD sur close et correspond au calcul sur la série hlc3", () => {
    const ohlcCandles: Candle[] = [
      { time: 0, open: 10, high: 10, low: 10, close: 10, volume: 0 },
      { time: 60_000, open: 10, high: 15, low: 9, close: 11, volume: 0 },
      { time: 120_000, open: 11, high: 12, low: 8, close: 10, volume: 0 },
      { time: 180_000, open: 10, high: 16, low: 11, close: 12, volume: 0 },
      { time: 240_000, open: 12, high: 18, low: 10, close: 13, volume: 0 },
      { time: 300_000, open: 13, high: 14, low: 9, close: 12, volume: 0 },
      { time: 360_000, open: 12, high: 20, low: 11, close: 14, volume: 0 },
    ];
    const params = { fast: 1, slow: 3, signal: 3 };

    const a = computeIndicator(macd, ohlcCandles, params);
    const b = computeIndicator(macd, ohlcCandles, { ...params, source: "hlc3" });

    expect(a.series.macd).not.toEqual(b.series.macd);

    const hlc3 = ohlcCandles.map((c) => (c.high + c.low + c.close) / 3);
    const expected = macd.calc(
      ohlcCandles,
      { ...params, source: "hlc3" },
      { hl2: [], hlc3: [], ohlc4: [], source: hlc3 }
    );
    expect(b.series.macd).toEqual(expected.series.macd);
    expect(b.series.signal).toEqual(expected.series.signal);
    expect(b.series.hist).toEqual(expected.series.hist);
  });
});
