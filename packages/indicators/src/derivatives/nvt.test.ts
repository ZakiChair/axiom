/**
 * @axiom/indicators — derivatives/nvt.test.ts
 *
 * NVT (Network Value to Transactions) : recopie directe de ctx.aux.nvt, jamais de throw si absent.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { nvt } from "./nvt";

function candle(): Candle {
  return { time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 };
}

const candles: Candle[] = new Array(5).fill(0).map(candle);
const baseCtx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

describe("nvt", () => {
  it("ctx.aux absent → série entièrement undefined, jamais de throw", () => {
    expect(() => nvt.calc(candles, {}, baseCtx)).not.toThrow();
    const res = nvt.calc(candles, {}, baseCtx);
    expect(res.series.nvt).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("ctx.aux.nvt absent (autre clé présente) → série entièrement undefined", () => {
    const res = nvt.calc(candles, {}, { ...baseCtx, aux: { mvrv: [1, 2, 3, 4, 5] } });
    expect(res.series.nvt).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("ctx.aux.nvt fourni → recopie exacte", () => {
    const nvtSeries = [65, 70, undefined, 80, 90];
    const res = nvt.calc(candles, {}, { ...baseCtx, aux: { nvt: nvtSeries } });
    expect(res.series.nvt).toEqual(nvtSeries);
  });

  it("métadonnées conformes", () => {
    expect(nvt.id).toBe("nvt");
    expect(nvt.category).toBe("derivatives");
    expect(nvt.pane).toBe("separate");
    expect(nvt.aux).toEqual(["nvt"]);
    expect(nvt.minTimeframe).toBe("1d");
  });
});
