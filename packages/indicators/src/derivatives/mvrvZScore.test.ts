/**
 * @axiom/indicators — derivatives/mvrvZScore.test.ts
 *
 * MVRV Z-Score = valeur canonique (realized-cap) recopiée depuis l'aux `mvrvZ`
 * (bitcoin-data.com). Moteur pur : simple recopie sur l'index des bougies.
 */
import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { mvrvZScore } from "./mvrvZScore";

function candles(n: number): Candle[] {
  return new Array(n).fill(0).map(() => ({ time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
}
const baseCtx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

describe("mvrvZScore", () => {
  it("recopie l'aux mvrvZ sur l'index des bougies", () => {
    const c = candles(3);
    const res = mvrvZScore.calc(c, {}, { ...baseCtx, aux: { mvrvZ: [0.35, undefined, 2.1] } });
    expect(res.series.mvrvZScore).toEqual([0.35, undefined, 2.1]);
  });

  it("aux absent → tout undefined, jamais de throw", () => {
    const c = candles(3);
    expect(() => mvrvZScore.calc(c, {}, baseCtx)).not.toThrow();
    expect(mvrvZScore.calc(c, {}, baseCtx).series.mvrvZScore).toEqual(new Array(3).fill(undefined));
  });

  it("métadonnées conformes (aux mvrvZ, pane separate, 1d)", () => {
    expect(mvrvZScore.id).toBe("mvrvZScore");
    expect(mvrvZScore.aux).toEqual(["mvrvZ"]);
    expect(mvrvZScore.minTimeframe).toBe("1d");
  });
});
