/**
 * @axiom/indicators — trend/dpo.test.ts
 *
 * Stratégie : DPO est linéaire -> cas EXACT calculé à la main.
 * Params length = 4  ->  shift = floor(4/2)+1 = 3.
 *
 * closes = [1, 2, 3, 4, 5, 6, 7, 9]
 * SMA(close,4) :
 *   i3=(1+2+3+4)/4=2.5 ; i4=(2+3+4+5)/4=3.5 ; i5=(3+4+5+6)/4=4.5 ;
 *   i6=(4+5+6+7)/4=5.5 ; i7=(5+6+7+9)/4=6.75
 * DPO[i] = close[i-3] - SMA[i] (défini dès i=3) :
 *   i3=1-2.5=-1.5 ; i4=2-3.5=-1.5 ; i5=3-4.5=-1.5 ; i6=4-5.5=-1.5 ; i7=5-6.75=-1.75
 */

import { describe, expect, it } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { dpo } from "./dpo";

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

const emptyCtx: CalcContext = { hl2: [], hlc3: [], ohlc4: [], source: [] };

describe("dpo", () => {
  it("valeurs exactes (length = 4, shift = 3)", () => {
    const candles = candlesFromCloses([1, 2, 3, 4, 5, 6, 7, 9]);
    const { series } = dpo.calc(candles, { length: 4 }, emptyCtx);
    expect(series.dpo).toEqual([
      undefined,
      undefined,
      undefined,
      -1.5,
      -1.5,
      -1.5,
      -1.5,
      -1.75,
    ]);
  });

  it("amorçage undefined et longueur conservée (défaut 20)", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
    const candles = candlesFromCloses(closes);
    const { series } = dpo.calc(candles, {}, emptyCtx);
    const out = series.dpo ?? [];
    expect(out).toHaveLength(60);
    // shift = 11, SMA pleine à i>=19 -> première valeur à l'index 19.
    expect(out[18]).toBeUndefined();
    expect(out[19]).toBeTypeOf("number");
  });
});
