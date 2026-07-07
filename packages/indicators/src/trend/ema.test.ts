/**
 * Tests EMA — valeurs de référence calculées À LA MAIN depuis la formule.
 *
 * Formule (cf. ../utils `ema`) :
 *   k = 2 / (length + 1)
 *   amorce = SMA des `length` premières clôtures, placée à l'index length-1
 *   ema[i] = close[i] * k + ema[i-1] * (1 - k)   pour i >= length
 *
 * Jeu déterministe : length = 3, clôtures = [1, 2, 3, 4, 5, 6].
 *   k = 2 / (3 + 1) = 0.5
 *   idx 0,1 -> undefined (fenêtre incomplète)
 *   idx 2 (amorce) = (1 + 2 + 3) / 3 = 2
 *   idx 3 = 4*0.5 + 2*0.5 = 3
 *   idx 4 = 5*0.5 + 3*0.5 = 4
 *   idx 5 = 6*0.5 + 4*0.5 = 5
 * => [undefined, undefined, 2, 3, 4, 5]
 */

import { describe, it, expect } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { computeIndicator } from "../engine";
import { ema } from "./ema";

/** Construit des bougies minimales à partir d'une série de clôtures. */
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

/** Construit un contexte minimal avec source = close (les tests EMA ne portent que sur close). */
function ctxFromCloses(closes: number[]): CalcContext {
  return { hl2: [], hlc3: [], ohlc4: [], source: closes };
}

describe("EMA", () => {
  it("expose le bon métadonnée déclarative", () => {
    expect(ema.id).toBe("ema");
    expect(ema.category).toBe("trend");
    expect(ema.pane).toBe("overlay");
    expect(ema.outputs).toEqual([{ key: "ema", name: "EMA", style: "line" }]);
  });

  it("calcule l'EMA en régime établi + undefined avant fenêtre pleine", () => {
    const closes = [1, 2, 3, 4, 5, 6];
    const candles = candlesFromCloses(closes);
    const result = ema.calc(candles, { length: 3 }, ctxFromCloses(closes));
    expect(result.series.ema).toEqual([undefined, undefined, 2, 3, 4, 5]);
  });

  it("utilise length=20 par défaut quand le paramètre est absent", () => {
    // 19 bougies < fenêtre de 20 -> aucune valeur calculable.
    const closes = Array.from({ length: 19 }, (_, i) => i + 1);
    const candles = candlesFromCloses(closes);
    const result = ema.calc(candles, {}, ctxFromCloses(closes));
    expect(result.series.ema).toEqual(new Array(19).fill(undefined));
  });

  it("EMA sur hlc3 diffère de EMA sur close et correspond au calcul sur la série hlc3", () => {
    const ohlcCandles: Candle[] = [
      { time: 0, open: 10, high: 10, low: 10, close: 10, volume: 0 },
      { time: 60_000, open: 10, high: 15, low: 9, close: 11, volume: 0 },
      { time: 120_000, open: 11, high: 12, low: 8, close: 10, volume: 0 },
      { time: 180_000, open: 10, high: 16, low: 11, close: 12, volume: 0 },
      { time: 240_000, open: 12, high: 18, low: 10, close: 13, volume: 0 },
      { time: 300_000, open: 13, high: 14, low: 9, close: 12, volume: 0 },
      { time: 360_000, open: 12, high: 20, low: 11, close: 14, volume: 0 },
    ];

    const a = computeIndicator(ema, ohlcCandles, { length: 3 });
    const b = computeIndicator(ema, ohlcCandles, { length: 3, source: "hlc3" });

    expect(a.series.ema).not.toEqual(b.series.ema);

    const hlc3 = ohlcCandles.map((c) => (c.high + c.low + c.close) / 3);
    const expected = ema.calc(
      ohlcCandles,
      { length: 3, source: "hlc3" },
      { hl2: [], hlc3: [], ohlc4: [], source: hlc3 }
    );
    expect(b.series.ema).toEqual(expected.series.ema);
  });
});
