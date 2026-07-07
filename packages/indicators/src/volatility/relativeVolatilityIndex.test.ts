/**
 * Test unitaire — Relative Volatility Index (Dorsey).
 * Propriétés (RSI sur l'écart-type -> invariants, pas de fausse précision) :
 *  - série alignée et amorcée undefined ;
 *  - RVI borné [0, 100] (invariant central) ;
 *  - tend vers 100 quand toute la volatilité est haussière (hausses pures).
 */

import { describe, it, expect } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { relativeVolatilityIndex } from "./relativeVolatilityIndex";

function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    time: i * 60_000,
    open: close,
    high: close,
    low: close,
    close,
    volume: 0,
  }));
}

const ctx: CalcContext = { hl2: [], hlc3: [], ohlc4: [], source: [] };

describe("relativeVolatilityIndex", () => {
  const closes = Array.from({ length: 50 }, (_, i) => 100 + 6 * Math.sin(i / 3) + i * 0.2);
  const candles = candlesFromCloses(closes);
  const { series } = relativeVolatilityIndex.calc(
    candles,
    { stdevLength: 10, smoothLength: 14 },
    ctx
  );

  it("expose une série alignée sur les bougies", () => {
    expect(Object.keys(series)).toEqual(["rvi"]);
    expect(series.rvi).toHaveLength(50);
  });

  it("amorce en undefined", () => {
    expect(series.rvi?.[0]).toBeUndefined();
  });

  it("reste borné dans [0, 100]", () => {
    for (const v of series.rvi ?? []) {
      if (v === undefined) continue;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it("vaut 100 quand les variations de prix sont toutes haussières", () => {
    // Hausses pures et variables (écart-type non nul, direction toujours up).
    const up = candlesFromCloses(
      Array.from({ length: 40 }, (_, i) => 100 + i * i * 0.01 + i)
    );
    const { series: s2 } = relativeVolatilityIndex.calc(
      up,
      { stdevLength: 10, smoothLength: 14 },
      ctx
    );
    const last = s2.rvi?.[39];
    expect(last).toBeDefined();
    if (last !== undefined) expect(last).toBeCloseTo(100, 6);
  });
});
