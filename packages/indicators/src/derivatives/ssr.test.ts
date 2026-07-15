/**
 * @axiom/indicators — derivatives/ssr.test.ts
 *
 * SSR = marketCap / stablecoinSupply (division élément par élément des deux aux).
 * Undefined si l'une manque ou si l'offre de stablecoins est nulle (garde /0).
 */
import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { ssr } from "./ssr";

function candles(n: number): Candle[] {
  return new Array(n).fill(0).map(() => ({ time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
}
const baseCtx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

describe("ssr", () => {
  it("divise marketcap par stablecoins élément par élément", () => {
    const c = candles(2);
    // BTC cap 1.2e12, offre stablecoins 1.5e11 → SSR = 8.
    const res = ssr.calc(c, {}, { ...baseCtx, aux: { marketcap: [1.2e12, 8e11], stablecoins: [1.5e11, 2e11] } });
    expect(res.series.ssr).toEqual([8, 4]);
  });

  it("undefined si stablecoins = 0 (garde division) ou série manquante", () => {
    const c = candles(2);
    const res = ssr.calc(c, {}, { ...baseCtx, aux: { marketcap: [1e12, 1e12], stablecoins: [0, undefined] } });
    expect(res.series.ssr).toEqual([undefined, undefined]);
  });

  it("aux absent → tout undefined, jamais de throw", () => {
    const c = candles(2);
    expect(() => ssr.calc(c, {}, baseCtx)).not.toThrow();
    expect(ssr.calc(c, {}, baseCtx).series.ssr).toEqual([undefined, undefined]);
  });

  it("métadonnées conformes (aux marketcap+stablecoins, 1d)", () => {
    expect(ssr.aux).toEqual(["marketcap", "stablecoins"]);
    expect(ssr.minTimeframe).toBe("1d");
  });
});
