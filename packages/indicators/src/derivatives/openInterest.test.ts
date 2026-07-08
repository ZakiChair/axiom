/**
 * @axiom/indicators — derivatives/openInterest.test.ts
 *
 * Open Interest : recopie directe de ctx.aux.oi, jamais de throw si absent.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { openInterest } from "./openInterest";

function candle(): Candle {
  return { time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 };
}

const candles: Candle[] = new Array(5).fill(0).map(candle);
const baseCtx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

describe("openInterest", () => {
  it("ctx.aux absent → série entièrement undefined, jamais de throw", () => {
    expect(() => openInterest.calc(candles, {}, baseCtx)).not.toThrow();
    const res = openInterest.calc(candles, {}, baseCtx);
    expect(res.series.openInterest).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("ctx.aux.oi absent (autre clé présente) → série entièrement undefined", () => {
    const res = openInterest.calc(candles, {}, { ...baseCtx, aux: { funding: [1, 2, 3, 4, 5] } });
    expect(res.series.openInterest).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("ctx.aux.oi fourni → recopie exacte", () => {
    const oi = [100, 110, undefined, 130, 140];
    const res = openInterest.calc(candles, {}, { ...baseCtx, aux: { oi } });
    expect(res.series.openInterest).toEqual(oi);
  });

  it("métadonnées conformes", () => {
    expect(openInterest.id).toBe("openInterest");
    expect(openInterest.category).toBe("derivatives");
    expect(openInterest.pane).toBe("separate");
    expect(openInterest.aux).toEqual(["oi"]);
    expect(openInterest.minTimeframe).toBe("1h");
  });
});
