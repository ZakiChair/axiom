/**
 * @axiom/indicators — trend/dema.test.ts
 *
 * DEMA = 2·EMA − EMA(EMA) : non-linéaire, on teste les PROPRIÉTÉS.
 *   - longueur alignée ; amorçage undefined ; valeurs finies ;
 *   - sur une série STRICTEMENT croissante, la DEMA (à faible lag) doit elle-même
 *     croître une fois pleinement amorcée.
 */

import { describe, expect, it } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { dema } from "./dema";

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

const ctx: CalcContext = { hl2: [], hlc3: [], ohlc4: [] };
const closes = Array.from({ length: 50 }, (_, i) => 100 + i);
const candles = candlesFromCloses(closes);

describe("dema (trend, overlay)", () => {
  it("produit une série alignée et amorcée à undefined", () => {
    const { series } = dema.calc(candles, { length: 10 }, ctx);
    expect(series.dema).toHaveLength(candles.length);
    expect(series.dema?.[0]).toBeUndefined();
  });

  it("ne produit que des valeurs finies une fois amorcé", () => {
    const { series } = dema.calc(candles, { length: 10 }, ctx);
    const defined = (series.dema ?? []).filter((v): v is number => v !== undefined);
    expect(defined.length).toBeGreaterThan(0);
    for (const v of defined) expect(Number.isFinite(v)).toBe(true);
  });

  it("croît sur une série croissante", () => {
    const { series } = dema.calc(candles, { length: 10 }, ctx);
    const s = series.dema ?? [];
    const last = s[s.length - 1];
    const mid = s[Math.floor(s.length / 2) + 5];
    expect(last).toBeDefined();
    expect(mid).toBeDefined();
    if (last !== undefined && mid !== undefined) expect(last).toBeGreaterThan(mid);
  });
});
