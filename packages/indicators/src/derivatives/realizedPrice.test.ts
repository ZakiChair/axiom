/**
 * @axiom/indicators — derivatives/realizedPrice.test.ts
 *
 * Realized Price = recopie de l'aux `realizedPrice` (USD, bitcoin-data.com) en OVERLAY
 * sur le prix. Moteur pur : simple recopie sur l'index des bougies.
 */
import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { realizedPrice } from "./realizedPrice";

function candles(n: number): Candle[] {
  return new Array(n).fill(0).map(() => ({ time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
}
const baseCtx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

describe("realizedPrice", () => {
  it("recopie l'aux realizedPrice sur l'index des bougies", () => {
    const c = candles(3);
    const res = realizedPrice.calc(c, {}, { ...baseCtx, aux: { realizedPrice: [52000, undefined, 53000] } });
    expect(res.series.realizedPrice).toEqual([52000, undefined, 53000]);
  });

  it("aux absent → tout undefined, jamais de throw", () => {
    const c = candles(2);
    expect(() => realizedPrice.calc(c, {}, baseCtx)).not.toThrow();
    expect(realizedPrice.calc(c, {}, baseCtx).series.realizedPrice).toEqual([undefined, undefined]);
  });

  it("métadonnées : OVERLAY sur le prix (aux dédié, 1d)", () => {
    expect(realizedPrice.pane).toBe("overlay");
    expect(realizedPrice.aux).toEqual(["realizedPrice"]);
    expect(realizedPrice.minTimeframe).toBe("1d");
  });
});
