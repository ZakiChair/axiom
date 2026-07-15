/**
 * @axiom/indicators — momentum/fearGreed.test.ts
 * Fear & Greed = recopie de l'aux `fearGreed` (0-100) sur l'index des bougies. Moteur pur.
 */
import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { fearGreed } from "./fearGreed";

function candles(n: number): Candle[] {
  return new Array(n).fill(0).map(() => ({ time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
}
const baseCtx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

describe("fearGreed", () => {
  it("recopie la série aux sur l'index des bougies", () => {
    const c = candles(3);
    const res = fearGreed.calc(c, {}, { ...baseCtx, aux: { fearGreed: [25, undefined, 72] } });
    expect(res.series.fearGreed).toEqual([25, undefined, 72]);
  });

  it("aux absent → tout undefined, jamais de throw", () => {
    const c = candles(2);
    expect(() => fearGreed.calc(c, {}, baseCtx)).not.toThrow();
    expect(fearGreed.calc(c, {}, baseCtx).series.fearGreed).toEqual([undefined, undefined]);
  });

  it("métadonnées : momentum, separate, aux dédié, 1d", () => {
    expect(fearGreed.category).toBe("momentum");
    expect(fearGreed.aux).toEqual(["fearGreed"]);
    expect(fearGreed.minTimeframe).toBe("1d");
  });
});
