import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { rogersSatchellVol } from "./rogersSatchellVol";

function ctxDe(candles: Candle[]) {
  return { hl2: [], hlc3: [], ohlc4: [], source: candles.map((c) => c.close) };
}

describe("rogersSatchellVol", () => {
  it("range constant O=C=100 : σ² = 2·ln(1,02)² → 54,0469 % annualisé", () => {
    const candles: Candle[] = Array.from({ length: 30 }, (_, i) => ({
      time: i,
      open: 100,
      high: 102,
      low: 98,
      close: 100,
      volume: 1,
    }));
    const { series } = rogersSatchellVol.calc(candles, { length: 20, periodsPerYear: 365 }, ctxDe(candles));
    expect(series.vol?.[19]).toBeCloseTo(54.0469, 3);
  });

  it("barre directionnelle O=100 C=110 : le terme reste ≥ 0 (pas de dérive supposée)", () => {
    const candles: Candle[] = Array.from({ length: 25 }, (_, i) => ({
      time: i,
      open: 100,
      high: 110.5,
      low: 99.9,
      close: 110,
      volume: 1,
    }));
    const { series } = rogersSatchellVol.calc(candles, { length: 20, periodsPerYear: 365 }, ctxDe(candles));
    const v = series.vol?.[24];
    expect(v).toBeDefined();
    expect(v!).toBeGreaterThan(0);
  });
});
