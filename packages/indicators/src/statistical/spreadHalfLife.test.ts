import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { spreadHalfLife } from "./spreadHalfLife";

/** LCG Numerical Recipes — bruit blanc déterministe (autocorrélation lag-1 ≈ 0). */
function genererBruit(): () => number {
  let seed = 123456789;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 4294967296 - 0.5) * 0.004;
  };
}

/** Spread AR(1) ρ = 0,8 (demi-vie théorique 3,1 barres) sur une rampe de référence. */
function jeu(n: number): { candles: Candle[]; ref: number[] } {
  const bruit = genererBruit();
  const closes: number[] = [];
  const ref: number[] = [];
  let e = 0;
  for (let i = 0; i < n; i++) {
    e = 0.8 * e + bruit();
    const x = Math.log(100) + 0.01 * i;
    ref.push(Math.exp(x));
    closes.push(Math.exp(x + e));
  }
  return {
    candles: closes.map((close, i) => ({ time: i, open: close, high: close, low: close, close, volume: 1 })),
    ref,
  };
}

function ctxDe(candles: Candle[], ref: number[] | undefined) {
  return {
    hl2: [],
    hlc3: [],
    ohlc4: [],
    source: candles.map((c) => c.close),
    aux: ref === undefined ? undefined : { refClose: ref },
  };
}

describe("spreadHalfLife", () => {
  it("expose demi-vie et β de couverture sur un spread qui revient à la moyenne", () => {
    const { candles, ref } = jeu(200);
    const { series } = spreadHalfLife.calc(candles, { length: 150, lags: 1 }, ctxDe(candles, ref));
    expect(series.hl?.[199]).toBeDefined();
    expect(series.hl![199]!).toBeGreaterThan(1);
    expect(series.hl![199]!).toBeLessThan(5);
    expect(series.beta?.[199]).toBeDefined();
    expect(Math.abs(series.beta![199]! - 1)).toBeLessThan(0.05);
  });

  it("sans référence : les deux sorties restent vides (pane muet assumé)", () => {
    const { candles } = jeu(200);
    const { series } = spreadHalfLife.calc(candles, { length: 150, lags: 1 }, ctxDe(candles, undefined));
    expect(series.hl?.every((v) => v === undefined)).toBe(true);
    expect(series.beta?.every((v) => v === undefined)).toBe(true);
  });

  it("fenêtre incomplète : premières positions indéfinies", () => {
    const { candles, ref } = jeu(200);
    const { series } = spreadHalfLife.calc(candles, { length: 150, lags: 1 }, ctxDe(candles, ref));
    expect(series.hl?.[100]).toBeUndefined();
    expect(series.beta?.[100]).toBeUndefined();
  });
});
