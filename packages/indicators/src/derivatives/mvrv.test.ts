/**
 * @axiom/indicators — derivatives/mvrv.test.ts
 *
 * MVRV (Market Value to Realized Value) : recopie directe de ctx.aux.mvrv, jamais de throw si absent.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { mvrv } from "./mvrv";

function candle(): Candle {
  return { time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 };
}

const candles: Candle[] = new Array(5).fill(0).map(candle);
const baseCtx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

describe("mvrv", () => {
  it("ctx.aux absent → série entièrement undefined, jamais de throw", () => {
    expect(() => mvrv.calc(candles, {}, baseCtx)).not.toThrow();
    const res = mvrv.calc(candles, {}, baseCtx);
    expect(res.series.mvrv).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("ctx.aux.mvrv absent (autre clé présente) → série entièrement undefined", () => {
    const res = mvrv.calc(candles, {}, { ...baseCtx, aux: { nvt: [1, 2, 3, 4, 5] } });
    expect(res.series.mvrv).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("ctx.aux.mvrv fourni → recopie exacte", () => {
    const mvrvSeries = [1.5, 1.8, undefined, 2.1, 2.4];
    const res = mvrv.calc(candles, {}, { ...baseCtx, aux: { mvrv: mvrvSeries } });
    expect(res.series.mvrv).toEqual(mvrvSeries);
  });

  it("métadonnées conformes", () => {
    expect(mvrv.id).toBe("mvrv");
    expect(mvrv.category).toBe("derivatives");
    expect(mvrv.pane).toBe("separate");
    expect(mvrv.aux).toEqual(["mvrv"]);
    expect(mvrv.minTimeframe).toBe("1d");
  });
});
