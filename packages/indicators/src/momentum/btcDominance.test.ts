/**
 * @axiom/indicators — momentum/btcDominance.test.ts
 * Recopie de l'aux `btcDominance` (%) sur l'index des bougies. Moteur pur.
 */
import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { btcDominance } from "./btcDominance";

function candles(n: number): Candle[] {
  return new Array(n).fill(0).map(() => ({ time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
}
const baseCtx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

describe("btcDominance", () => {
  it("recopie l'aux sur l'index des bougies", () => {
    const c = candles(3);
    const res = btcDominance.calc(c, {}, { ...baseCtx, aux: { btcDominance: [56.3, undefined, 54.1] } });
    expect(res.series.btcDominance).toEqual([56.3, undefined, 54.1]);
  });

  it("aux absent → tout undefined, jamais de throw", () => {
    const c = candles(2);
    expect(() => btcDominance.calc(c, {}, baseCtx)).not.toThrow();
    expect(btcDominance.calc(c, {}, baseCtx).series.btcDominance).toEqual([undefined, undefined]);
  });

  it("métadonnées (momentum, separate, aux dédié)", () => {
    expect(btcDominance.category).toBe("momentum");
    expect(btcDominance.aux).toEqual(["btcDominance"]);
  });
});
