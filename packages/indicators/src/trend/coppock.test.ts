/**
 * @axiom/indicators — trend/coppock.test.ts
 *
 * Stratégie : Coppock = WMA(ROC long + ROC court) est linéaire -> cas EXACT.
 * Params : longRoC = 2, shortRoC = 1, wmaLength = 2.
 *
 * closes = [10, 20, 40, 50]
 *   ROC(close,2) : i2=(40-10)/10*100=300 ; i3=(50-20)/20*100=150
 *   ROC(close,1) : i1=100 ; i2=(40-20)/20*100=100 ; i3=(50-40)/40*100=25
 *   sum = ROC2 + ROC1 : i2=400 ; i3=175
 *   WMA(sum,2) (poids 1 ancien, 2 récent ; ΣP=3), défini dès i=3 :
 *     i3 = (1*400 + 2*175)/3 = (400 + 350)/3 = 750/3 = 250
 */

import { describe, expect, it } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { coppock } from "./coppock";

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

describe("coppock", () => {
  it("valeur exacte (longRoC=2, shortRoC=1, wma=2)", () => {
    const candles = candlesFromCloses([10, 20, 40, 50]);
    const { series } = coppock.calc(
      candles,
      { longRoC: 2, shortRoC: 1, wmaLength: 2 },
      emptyCtx
    );
    expect(series.coppock).toEqual([undefined, undefined, undefined, 250]);
  });

  it("amorçage undefined et longueur conservée (défauts)", () => {
    const closes = Array.from({ length: 50 }, (_, i) => 100 + Math.cos(i / 4) * 8 + i * 0.5);
    const candles = candlesFromCloses(closes);
    const { series } = coppock.calc(candles, {}, emptyCtx);
    const out = series.coppock ?? [];
    expect(out).toHaveLength(50);
    // ROC long=14 + WMA 10 -> première valeur à l'index 14 + 9 = 23.
    expect(out[22]).toBeUndefined();
    expect(out[23]).toBeTypeOf("number");
  });
});
