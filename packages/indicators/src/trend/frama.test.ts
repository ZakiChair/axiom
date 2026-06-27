/**
 * @axiom/indicators — trend/frama.test.ts
 *
 * FRAMA est adaptatif via la dimension fractale : on teste les PROPRIÉTÉS, pas
 * une valeur fabriquée (anti fausse-précision §15.4).
 *   - longueur alignée ; amorçage undefined avant la fenêtre pleine ;
 *   - valeurs finies et bornées par l'enveloppe des clôtures ;
 *   - sur une série plate, FRAMA reste égal à la constante.
 */

import { describe, expect, it } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { frama } from "./frama";

// Bougies avec high/low non dégénérés (étendue réelle pour la dimension fractale).
function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    time: i * 60_000,
    open: close,
    high: close + 1.5,
    low: close - 1.5,
    close,
    volume: 1,
  }));
}

const ctx: CalcContext = { hl2: [], hlc3: [], ohlc4: [] };
const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 0.3 + Math.sin(i / 4) * 6);
const candles = candlesFromCloses(closes);

describe("frama (trend, overlay)", () => {
  it("amorce undefined avant la première fenêtre pleine", () => {
    const { series } = frama.calc(candles, { length: 16 }, ctx);
    expect(series.frama).toHaveLength(candles.length);
    for (let i = 0; i < 15; i++) expect(series.frama?.[i]).toBeUndefined();
    expect(series.frama?.[15]).toBeDefined();
  });

  it("reste fini et borné par l'enveloppe des bougies", () => {
    const { series } = frama.calc(candles, { length: 16 }, ctx);
    const lo = Math.min(...closes) - 1.5;
    const hi = Math.max(...closes) + 1.5;
    const defined = (series.frama ?? []).filter((v): v is number => v !== undefined);
    expect(defined.length).toBeGreaterThan(0);
    for (const v of defined) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(v).toBeLessThanOrEqual(hi + 1e-9);
    }
  });

  it("reste constant sur une série plate", () => {
    const flat = candlesFromCloses(new Array(40).fill(25));
    const { series } = frama.calc(flat, { length: 16 }, ctx);
    expect(series.frama?.[39]).toBeCloseTo(25, 6);
  });
});
