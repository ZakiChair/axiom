/**
 * @axiom/indicators — trend/zlema.test.ts
 *
 * ZLEMA = EMA(2·close − close[lag]) : non-linéaire (compaction EMA), PROPRIÉTÉS.
 *   - longueur alignée ; amorçage undefined ; valeurs finies ;
 *   - sur une série plate, ZLEMA converge vers la constante.
 */

import { describe, expect, it } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { zlema } from "./zlema";

function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    time: i * 60_000,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }));
}

const ctx: CalcContext = { hl2: [], hlc3: [], ohlc4: [], source: [] };

describe("zlema (trend, overlay)", () => {
  const candles = candlesFromCloses(
    Array.from({ length: 50 }, (_, i) => 80 + i * 0.6 + Math.sin(i / 4) * 4)
  );

  it("produit une série alignée et amorcée à undefined", () => {
    const { series } = zlema.calc(candles, { length: 14 }, ctx);
    expect(series.zlema).toHaveLength(candles.length);
    expect(series.zlema?.[0]).toBeUndefined();
  });

  it("ne produit que des valeurs finies une fois amorcé", () => {
    const { series } = zlema.calc(candles, { length: 14 }, ctx);
    const defined = (series.zlema ?? []).filter((v): v is number => v !== undefined);
    expect(defined.length).toBeGreaterThan(0);
    for (const v of defined) expect(Number.isFinite(v)).toBe(true);
  });

  it("converge vers la constante sur une série plate", () => {
    const flat = candlesFromCloses(new Array(40).fill(33));
    const { series } = zlema.calc(flat, { length: 14 }, ctx);
    const s = series.zlema ?? [];
    const last = s[s.length - 1];
    expect(last).toBeDefined();
    if (last !== undefined) expect(last).toBeCloseTo(33, 9);
  });
});
