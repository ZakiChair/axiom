import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { yangZhangVol } from "./yangZhangVol";

function ctxDe(candles: Candle[]) {
  return { hl2: [], hlc3: [], ohlc4: [], source: candles.map((c) => c.close) };
}

describe("yangZhangVol", () => {
  it("range constant O=C=100 : σ² = (1−k)·σ²_RS → 50,1489 % annualisé (N=20)", () => {
    // k = 0,34 / (1,34 + 21/19) = 0,139044 ; σ²_RS = 2·ln(1,02)² = 0,000800293
    const candles: Candle[] = Array.from({ length: 40 }, (_, i) => ({
      time: i,
      open: 100,
      high: 102,
      low: 98,
      close: 100,
      volume: 1,
    }));
    const { series } = yangZhangVol.calc(candles, { length: 20, periodsPerYear: 365 }, ctxDe(candles));
    expect(series.vol?.[19]).toBeUndefined(); // il faut la clôture précédant la fenêtre
    expect(series.vol?.[20]).toBeCloseTo(50.1489, 3);
  });

  it("capte le saut overnight là où Rogers-Satchell est nul (barres sans range intra)", () => {
    // Barres « ligne » (H=L=max(O,C)) : σ²_RS = 0. Le prix saute entre la clôture et
    // l'ouverture suivante (±1 %), donc σ²_o > 0 et la vol reste définie.
    const candles: Candle[] = Array.from({ length: 40 }, (_, i) => {
      const [open, close] = i % 2 === 0 ? [100, 101] : [102, 101];
      return { time: i, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
    });
    const { series } = yangZhangVol.calc(candles, { length: 20, periodsPerYear: 365 }, ctxDe(candles));
    const v = series.vol?.[39];
    expect(v).toBeDefined();
    expect(v!).toBeGreaterThan(0);
  });
});
