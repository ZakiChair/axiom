/**
 * @axiom/indicators — derivatives/fundingNotional.test.ts
 *
 * Funding notionnel = funding[i] × oi[i] (produit élément par élément des deux séries
 * aux). Undefined si l'une des deux manque à l'index. Signe = côté qui paie.
 */
import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { fundingNotional } from "./fundingNotional";

function candles(n: number): Candle[] {
  return new Array(n).fill(0).map(() => ({ time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
}
const baseCtx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

describe("fundingNotional", () => {
  it("multiplie funding par oi élément par élément", () => {
    const c = candles(3);
    const funding = [0.001, -0.002, 0.0005];
    const oi = [1_000_000, 2_000_000, 4_000_000];
    const res = fundingNotional.calc(c, {}, { ...baseCtx, aux: { funding, oi } });
    expect(res.series.fundingNotional).toEqual([1_000, -4_000, 2_000]);
  });

  it("undefined si funding OU oi manque à l'index", () => {
    const c = candles(3);
    const funding = [0.001, undefined, 0.001];
    const oi = [1_000_000, 2_000_000, undefined];
    const res = fundingNotional.calc(c, {}, { ...baseCtx, aux: { funding, oi } });
    expect(res.series.fundingNotional).toEqual([1_000, undefined, undefined]);
  });

  it("aux absent → tout undefined, jamais de throw", () => {
    const c = candles(3);
    expect(() => fundingNotional.calc(c, {}, baseCtx)).not.toThrow();
    expect(fundingNotional.calc(c, {}, baseCtx).series.fundingNotional).toEqual([undefined, undefined, undefined]);
  });

  it("métadonnées conformes (aux funding+oi, histogram)", () => {
    expect(fundingNotional.aux).toEqual(["funding", "oi"]);
    expect(fundingNotional.outputs[0]?.style).toBe("histogram");
  });
});
