/**
 * @axiom/indicators — volatility/priceZScore.test.ts
 *
 * Jeu déterministe repris de stddev.test.ts (mêmes closes = [1, 2, 3, 4, 6],
 * length = 3) : évite de recalculer SMA/stdev à la main, seul le z-score final
 * change.
 *
 *   idx 2 : fenêtre [1,2,3] -> sma = 2,        stdev = 0.81649658 (sqrt(2/3))
 *           z = (3 - 2) / 0.81649658          = 1.22474487  (sqrt(3/2))
 *   idx 3 : fenêtre [2,3,4] -> sma = 3,        stdev = 0.81649658 (sqrt(2/3))
 *           z = (4 - 3) / 0.81649658          = 1.22474487
 *   idx 4 : fenêtre [3,4,6] -> sma = 13/3,     stdev = 1.24721913 (sqrt(14)/3)
 *           z = (6 - 13/3) / 1.24721913       = 1.33630621 (5/sqrt(14))
 */

import { describe, it, expect } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { priceZScore } from "./priceZScore";
import { computeIndicator } from "../engine";

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

const ctx: CalcContext = { hl2: [], hlc3: [], ohlc4: [], source: [1, 2, 3, 4, 6] };

describe("priceZScore", () => {
  const candles = candlesFromCloses([1, 2, 3, 4, 6]);
  const { series } = priceZScore.calc(candles, { length: 3 }, ctx);

  it("expose des séries alignées sur les bougies", () => {
    expect(Object.keys(series).sort()).toEqual(["hi", "lo", "z"]);
    expect(series.z).toHaveLength(5);
    expect(series.hi).toHaveLength(5);
    expect(series.lo).toHaveLength(5);
  });

  it("laisse z undefined avant la première fenêtre pleine", () => {
    expect(series.z?.[0]).toBeUndefined();
    expect(series.z?.[1]).toBeUndefined();
  });

  it("calcule le z-score exact en régime établi", () => {
    expect(series.z?.[2]).toBeCloseTo(1.22474487, 7);
    expect(series.z?.[3]).toBeCloseTo(1.22474487, 7);
    expect(series.z?.[4]).toBeCloseTo(1.33630621, 7);
  });

  it("expose des bandes constantes +2/-2 sur toute la série", () => {
    for (const v of series.hi ?? []) expect(v).toBe(2);
    for (const v of series.lo ?? []) expect(v).toBe(-2);
  });

  it("stdev nulle (série constante) -> z undefined même fenêtre pleine", () => {
    const flat = candlesFromCloses([5, 5, 5, 5, 5]);
    const flatCtx: CalcContext = { hl2: [], hlc3: [], ohlc4: [], source: [5, 5, 5, 5, 5] };
    const { series: flatSeries } = priceZScore.calc(flat, { length: 3 }, flatCtx);

    for (const v of flatSeries.z ?? []) expect(v).toBeUndefined();
  });

  it("respecte le param source (hl2 au lieu de close)", () => {
    // OHLC distincts pour que hl2 != close ; 12 bougies pour dépasser le min
    // d'input (length clampé à 10 par resolveParams — cf. engine.ts) et couvrir
    // au moins 3 points de fenêtre pleine.
    const closes = [10, 11, 10, 12, 13, 12, 14, 10, 13, 11, 14, 12];
    const highs = [10, 15, 12, 16, 18, 14, 20, 13, 17, 14, 19, 15];
    const lows = [10, 9, 8, 11, 10, 9, 11, 8, 10, 9, 12, 10];
    const ohlcCandles: Candle[] = closes.map((close, i) => ({
      time: i * 60_000,
      open: close,
      high: highs[i]!,
      low: lows[i]!,
      close,
      volume: 0,
    }));

    // length demandé = 10 (= min d'input, pas de clamp implicite qui fausserait le test).
    const a = computeIndicator(priceZScore, ohlcCandles, { length: 10 });
    const b = computeIndicator(priceZScore, ohlcCandles, { length: 10, source: "hl2" });

    expect(a.series.z).not.toEqual(b.series.z);

    const hl2 = ohlcCandles.map((c) => (c.high + c.low) / 2);
    const expected = priceZScore.calc(
      ohlcCandles,
      { length: 10, source: "hl2" },
      { hl2: [], hlc3: [], ohlc4: [], source: hl2 }
    );
    expect(b.series.z).toEqual(expected.series.z);
  });

  it("clampe length dans [10, 500] et défaut 100 via le moteur (resolveParams)", () => {
    // 5 bougies < défaut 100 -> aucune fenêtre pleine -> tout undefined, pas d'erreur.
    const short = computeIndicator(priceZScore, candles, {});
    expect(short.series.z?.every((v) => v === undefined)).toBe(true);
  });
});
