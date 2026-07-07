/**
 * @axiom/indicators — trend/kama.test.ts
 *
 * KAMA est adaptatif (Efficiency Ratio) : on teste les PROPRIÉTÉS, jamais une
 * valeur "attendue" fabriquée (anti fausse-précision §15.4).
 *   - longueur alignée ; amorçage undefined avant la fenêtre pleine ;
 *   - valeurs finies et bornées par l'enveloppe [min, max] des clôtures ;
 *   - sur une série plate, KAMA reste égal à la constante.
 */

import { describe, expect, it } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { kama } from "./kama";

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
const closes = Array.from({ length: 50 }, (_, i) => 100 + i * 0.4 + Math.sin(i / 3) * 5);
const candles = candlesFromCloses(closes);

describe("kama (trend, overlay)", () => {
  it("amorce undefined avant la première fenêtre pleine", () => {
    const { series } = kama.calc(candles, { length: 10 }, ctx);
    expect(series.kama).toHaveLength(candles.length);
    for (let i = 0; i < 9; i++) expect(series.kama?.[i]).toBeUndefined();
    expect(series.kama?.[9]).toBeDefined();
  });

  it("reste fini et borné par l'enveloppe des clôtures", () => {
    const { series } = kama.calc(candles, { length: 10 }, ctx);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const defined = (series.kama ?? []).filter((v): v is number => v !== undefined);
    expect(defined.length).toBeGreaterThan(0);
    for (const v of defined) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(min - 1e-9);
      expect(v).toBeLessThanOrEqual(max + 1e-9);
    }
  });

  it("reste constant sur une série plate", () => {
    const flat = candlesFromCloses(new Array(30).fill(15));
    const { series } = kama.calc(flat, { length: 10 }, ctx);
    expect(series.kama?.[29]).toBeCloseTo(15, 9);
  });
});
