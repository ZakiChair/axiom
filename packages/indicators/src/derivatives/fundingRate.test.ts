/**
 * @axiom/indicators — derivatives/fundingRate.test.ts
 *
 * Funding Rate : recopie directe de ctx.aux.funding, jamais de throw si absent.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { fundingRate } from "./fundingRate";

function candle(): Candle {
  return { time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 };
}

const candles: Candle[] = new Array(5).fill(0).map(candle);
const baseCtx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

describe("fundingRate", () => {
  it("ctx.aux absent → série entièrement undefined, jamais de throw", () => {
    expect(() => fundingRate.calc(candles, {}, baseCtx)).not.toThrow();
    const res = fundingRate.calc(candles, {}, baseCtx);
    expect(res.series.fundingRate).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("ctx.aux.funding absent (autre clé présente) → série entièrement undefined", () => {
    const res = fundingRate.calc(candles, {}, { ...baseCtx, aux: { oi: [1, 2, 3, 4, 5] } });
    expect(res.series.fundingRate).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("ctx.aux.funding fourni → recopie exacte", () => {
    const funding = [0.0001, -0.0002, undefined, 0.0003, 0.0001];
    const res = fundingRate.calc(candles, {}, { ...baseCtx, aux: { funding } });
    expect(res.series.fundingRate).toEqual(funding);
  });

  it("métadonnées conformes", () => {
    expect(fundingRate.id).toBe("fundingRate");
    expect(fundingRate.category).toBe("derivatives");
    expect(fundingRate.pane).toBe("separate");
    expect(fundingRate.aux).toEqual(["funding"]);
    expect(fundingRate.minTimeframe).toBe("1h");
    expect(fundingRate.outputs[0]?.style).toBe("histogram");
  });
});
