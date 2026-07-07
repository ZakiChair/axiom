/**
 * @axiom/indicators — trend/trix.test.ts
 *
 * Stratégie : TRIX enchaîne trois EMA (indicateur non trivial) — on évite la
 * fausse précision sur les défauts. On vérifie :
 *  (a) longueur de sortie + amorçage `undefined` ;
 *  (b) un cas EXACT calculé à la main avec length = 1 : EMA(_,1) = identité, donc
 *      la triple EMA vaut close, et TRIX = ROC 1 période en % de close.
 */

import { describe, expect, it } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { trix } from "./trix";

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

describe("trix", () => {
  it("length = 1 : triple EMA = close, TRIX = ROC1 en % (valeurs exactes)", () => {
    // closes = [10, 20, 40] -> trix[1] = (20-10)/10*100 = 100 ; trix[2] = (40-20)/20*100 = 100.
    const candles = candlesFromCloses([10, 20, 40]);
    const { series } = trix.calc(candles, { length: 1 }, emptyCtx);
    expect(series.trix).toEqual([undefined, 100, 100]);
  });

  it("amorçage undefined et longueur conservée (défaut 18)", () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i);
    const candles = candlesFromCloses(closes);
    const { series } = trix.calc(candles, {}, emptyCtx);
    const out = series.trix ?? [];
    expect(out).toHaveLength(80);
    // length=18 : 3 EMA enchaînées (seed à 17 chacune) -> première valeur à l'index 52.
    expect(out[0]).toBeUndefined();
    expect(out[51]).toBeUndefined();
    expect(out[52]).toBeTypeOf("number");
    for (const v of out) {
      if (v !== undefined) expect(Number.isFinite(v)).toBe(true);
    }
  });
});
