/**
 * @axiom/indicators — derivatives/stablecoinSupply.test.ts
 *
 * Stablecoin Supply : recopie directe de ctx.aux.stablecoins, jamais de throw si absent.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { stablecoinSupply } from "./stablecoinSupply";

function candle(): Candle {
  return { time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 };
}

const candles: Candle[] = new Array(5).fill(0).map(candle);
const baseCtx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

describe("stablecoinSupply", () => {
  it("ctx.aux absent → série entièrement undefined, jamais de throw", () => {
    expect(() => stablecoinSupply.calc(candles, {}, baseCtx)).not.toThrow();
    const res = stablecoinSupply.calc(candles, {}, baseCtx);
    expect(res.series.stablecoinSupply).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("ctx.aux.stablecoins absent (autre clé présente) → série entièrement undefined", () => {
    const res = stablecoinSupply.calc(candles, {}, { ...baseCtx, aux: { oi: [1, 2, 3, 4, 5] } });
    expect(res.series.stablecoinSupply).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("ctx.aux.stablecoins fourni → recopie exacte", () => {
    const stablecoins = [1e11, 1.01e11, undefined, 1.02e11, 1.03e11];
    const res = stablecoinSupply.calc(candles, {}, { ...baseCtx, aux: { stablecoins } });
    expect(res.series.stablecoinSupply).toEqual(stablecoins);
  });

  it("métadonnées conformes", () => {
    expect(stablecoinSupply.id).toBe("stablecoinSupply");
    expect(stablecoinSupply.category).toBe("derivatives");
    expect(stablecoinSupply.pane).toBe("separate");
    expect(stablecoinSupply.aux).toEqual(["stablecoins"]);
    expect(stablecoinSupply.minTimeframe).toBe("1d");
  });
});
