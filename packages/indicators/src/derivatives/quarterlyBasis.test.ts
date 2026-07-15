/**
 * @axiom/indicators — derivatives/quarterlyBasis.test.ts
 *
 * L'indicateur recopie la série aux `quarterlyBasis` (basis annualisé % p.a. du future
 * trimestriel, calculé côté data layer) sur l'index des bougies. Moteur pur.
 */
import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { quarterlyBasis } from "./quarterlyBasis";

function candles(n: number): Candle[] {
  return new Array(n).fill(0).map(() => ({ time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
}
const baseCtx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

describe("quarterlyBasis", () => {
  it("recopie la série aux (contango + / backwardation −)", () => {
    const c = candles(3);
    const res = quarterlyBasis.calc(c, {}, { ...baseCtx, aux: { quarterlyBasis: [8.5, undefined, -3.2] } });
    expect(res.series.quarterlyBasis).toEqual([8.5, undefined, -3.2]);
  });

  it("aux absent → tout undefined, jamais de throw", () => {
    const c = candles(2);
    expect(() => quarterlyBasis.calc(c, {}, baseCtx)).not.toThrow();
    expect(quarterlyBasis.calc(c, {}, baseCtx).series.quarterlyBasis).toEqual([undefined, undefined]);
  });

  it("métadonnées conformes (aux dédié, histogram, 1h)", () => {
    expect(quarterlyBasis.aux).toEqual(["quarterlyBasis"]);
    expect(quarterlyBasis.outputs[0]?.style).toBe("histogram");
    expect(quarterlyBasis.minTimeframe).toBe("1h");
  });
});
