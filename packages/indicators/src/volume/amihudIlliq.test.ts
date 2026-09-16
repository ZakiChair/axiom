import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { amihudIlliq } from "./amihudIlliq";

function ctxDe(candles: Candle[]) {
  return { hl2: [], hlc3: [], ohlc4: [], source: candles.map((c) => c.close) };
}

describe("amihudIlliq", () => {
  it("prix constant : rendement nul → ILLIQ = 0", () => {
    const candles: Candle[] = Array.from({ length: 40 }, (_, i) => ({
      time: i,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      volume: 10,
      quoteVolume: 1000,
    }));
    const { series } = amihudIlliq.calc(candles, { length: 30 }, ctxDe(candles));
    expect(series.illiq?.[30]).toBe(0);
  });

  it("|r| = ln 2 sur 5 rendements et DV = 1000 : ILLIQ = 10⁶·ln2/1000 = 693,15", () => {
    // Clôtures alternées 100/200 : chaque rendement log vaut ±ln 2.
    const candles: Candle[] = Array.from({ length: 8 }, (_, i) => {
      const close = i % 2 === 0 ? 100 : 200;
      return { time: i, open: close, high: close, low: close, close, volume: 5, quoteVolume: 1000 };
    });
    const { series } = amihudIlliq.calc(candles, { length: 5 }, ctxDe(candles));
    expect(series.illiq?.[5]).toBeCloseTo((1e6 * Math.LN2) / 1000, 6);
  });

  it("barre sans volume : fenêtre invalidée (aucun zéro fabriqué)", () => {
    const candles: Candle[] = Array.from({ length: 40 }, (_, i) => ({
      time: i,
      open: 100 + i,
      high: 100 + i,
      low: 100 + i,
      close: 100 + i,
      volume: i === 39 ? 0 : 10,
      quoteVolume: i === 39 ? 0 : 1000,
    }));
    const { series } = amihudIlliq.calc(candles, { length: 30 }, ctxDe(candles));
    expect(series.illiq?.[39]).toBeUndefined();
    expect(series.illiq?.[38]).toBeDefined();
  });

  it("quoteVolume absent : repli sur close × volume", () => {
    const candles: Candle[] = Array.from({ length: 40 }, (_, i) => {
      const close = i % 2 === 0 ? 100 : 200;
      return { time: i, open: close, high: close, low: close, close, volume: 10 };
    });
    const { series } = amihudIlliq.calc(candles, { length: 30 }, ctxDe(candles));
    // close varie, DV = close × 10 → valeur définie et positive.
    expect(series.illiq?.[39]).toBeGreaterThan(0);
  });
});
