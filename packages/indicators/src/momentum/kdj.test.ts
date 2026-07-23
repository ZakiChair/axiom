/**
 * @axiom/indicators — momentum/kdj.test.ts
 *
 * KDJ : deux fixtures.
 *
 * 1) Défauts (length=9, signalK=3, signalD=3), closes = high = low =
 *    [1..12] (monotone croissante) : RSV[i] = 100 pour tout i car close = HH
 *    de la fenêtre et LL = close - 8. Amorce undefined pour i < 8. Seed K=D=50.
 *
 *      i=8  : rsv=100  K=((2*50)+100)/3       = 66.66666667
 *                       D=((2*50)+66.66666667)/3 = 55.55555556
 *                       J=3K-2D                = 88.88888889
 *      i=9  : rsv=100  K=(2*66.66666667+100)/3 = 77.77777778
 *                       D=(2*55.55555556+77.77777778)/3 = 62.96296296
 *                       J=3K-2D                = 107.40740741
 *      i=10 : rsv=100  K=(2*77.77777778+100)/3 = 85.18518519
 *                       D=(2*62.96296296+85.18518519)/3 = 70.37037037
 *                       J=3K-2D                = 114.81481481
 *      i=11 : rsv=100  K=(2*85.18518519+100)/3 = 90.12345679
 *                       D=(2*70.37037037+90.12345679)/3 = 76.95473251
 *                       J=3K-2D                = 116.46090535
 *
 * 2) length=3, signalK=3, signalD=3, série plate ponctuelle : valeurs
 *    high=low=close = [5, 5, 5, 10, 5, 5, 5].
 *
 *      i=0,1 : fenêtre incomplète -> undefined
 *      i=2   : fenêtre [5,5,5] -> HH=LL=5 -> RSV undefined -> K/D reconduisent
 *              le seed 50/50 (premier point calculé) -> J = 3*50-2*50 = 50
 *      i=3   : fenêtre [5,5,10] -> HH=10,LL=5 -> RSV=100
 *              K=(2*50+100)/3=66.66666667 ; D=(2*50+66.66666667)/3=55.55555556
 *              J=88.88888889
 *      i=4   : fenêtre [5,10,5] close=5 -> HH=10,LL=5 -> RSV=0
 *              K=(2*66.66666667+0)/3=44.44444444
 *              D=(2*55.55555556+44.44444444)/3=51.85185185
 *              J=29.62962963
 *      i=5   : fenêtre [10,5,5] close=5 -> HH=10,LL=5 -> RSV=0
 *              K=(2*44.44444444+0)/3=29.62962963
 *              D=(2*51.85185185+29.62962963)/3=44.44444444
 *              J=0
 *      i=6   : fenêtre [5,5,5] -> HH=LL=5 -> RSV undefined -> K/D reconduits
 *              (29.62962963 / 44.44444444, valeurs de i=5, PAS le seed) -> J=0
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { kdj } from "./kdj";

function candlesFromValues(values: number[]): Candle[] {
  return values.map((v, i) => ({
    time: i * 60_000,
    open: v,
    high: v,
    low: v,
    close: v,
    volume: 0,
  }));
}

describe("KDJ", () => {
  it("respecte les défauts (length=9, signalK=3, signalD=3) et calcule K/D/J hand-calc", () => {
    const candles = candlesFromValues([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const { series } = computeIndicator(kdj, candles, {});

    expect(Object.keys(series).sort()).toEqual(["d", "j", "k"]);
    expect(series.k).toHaveLength(12);

    // Fenêtre incomplète (i < length-1 = 8) -> undefined.
    for (let i = 0; i < 8; i++) {
      expect(series.k?.[i]).toBeUndefined();
      expect(series.d?.[i]).toBeUndefined();
      expect(series.j?.[i]).toBeUndefined();
    }

    expect(series.k?.[8]).toBeCloseTo(66.66666667, 6);
    expect(series.d?.[8]).toBeCloseTo(55.55555556, 6);
    expect(series.j?.[8]).toBeCloseTo(88.88888889, 6);

    expect(series.k?.[9]).toBeCloseTo(77.77777778, 6);
    expect(series.d?.[9]).toBeCloseTo(62.96296296, 6);
    expect(series.j?.[9]).toBeCloseTo(107.40740741, 6);

    expect(series.k?.[10]).toBeCloseTo(85.18518519, 6);
    expect(series.d?.[10]).toBeCloseTo(70.37037037, 6);
    expect(series.j?.[10]).toBeCloseTo(114.81481481, 6);

    expect(series.k?.[11]).toBeCloseTo(90.12345679, 6);
    expect(series.d?.[11]).toBeCloseTo(76.95473251, 6);
    expect(series.j?.[11]).toBeCloseTo(116.46090535, 6);

    // J déborde librement au-delà de 100 : pas de clamp.
    expect(series.j?.[11]!).toBeGreaterThan(100);
  });

  it("bougie plate (HH==LL) -> RSV undefined, K/D reconduits, y compris au premier point (seed)", () => {
    const candles = candlesFromValues([5, 5, 5, 10, 5, 5, 5]);
    const { series } = computeIndicator(kdj, candles, {
      length: 3,
      signalK: 3,
      signalD: 3,
    });

    expect(series.k?.[0]).toBeUndefined();
    expect(series.k?.[1]).toBeUndefined();

    // i=2 : première fenêtre pleine, plate -> reconduit le seed 50/50.
    expect(series.k?.[2]).toBeCloseTo(50, 9);
    expect(series.d?.[2]).toBeCloseTo(50, 9);
    expect(series.j?.[2]).toBeCloseTo(50, 9);

    expect(series.k?.[3]).toBeCloseTo(66.66666667, 6);
    expect(series.d?.[3]).toBeCloseTo(55.55555556, 6);
    expect(series.j?.[3]).toBeCloseTo(88.88888889, 6);

    expect(series.k?.[4]).toBeCloseTo(44.44444444, 6);
    expect(series.d?.[4]).toBeCloseTo(51.85185185, 6);
    expect(series.j?.[4]).toBeCloseTo(29.62962963, 6);

    expect(series.k?.[5]).toBeCloseTo(29.62962963, 6);
    expect(series.d?.[5]).toBeCloseTo(44.44444444, 6);
    expect(series.j?.[5]).toBeCloseTo(0, 6);

    // i=6 : plate à nouveau -> reconduit K/D de i=5 (pas le seed).
    expect(series.k?.[6]).toBeCloseTo(29.62962963, 6);
    expect(series.d?.[6]).toBeCloseTo(44.44444444, 6);
    expect(series.j?.[6]).toBeCloseTo(0, 6);
  });

  it("aucune valeur NaN dans les séries de sortie", () => {
    const candles = candlesFromValues([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const { series } = computeIndicator(kdj, candles, {});
    for (const key of ["k", "d", "j"] as const) {
      for (const v of series[key] ?? []) {
        if (v !== undefined) expect(Number.isNaN(v)).toBe(false);
      }
    }
  });
});
