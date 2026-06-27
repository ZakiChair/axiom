/**
 * @axiom/indicators — momentum/ultimateOsc.test.ts
 *
 * UO : oscillateur composite borné -> on teste l'amorçage, la longueur, l'invariant
 * de borne (UO ∈ [0, 100]) et le cas dégénéré (hausse stricte fermant au plus haut
 * -> BP == TR sur chaque barre -> UO = 100).
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { ultimateOsc } from "./ultimateOsc";

function candle(i: number, high: number, low: number, close: number): Candle {
  return { time: i * 60_000, open: low, high, low, close, volume: 0 };
}

describe("Ultimate Oscillator", () => {
  it("amorçage undefined puis bornage UO ∈ [0,100] (7/14/28)", () => {
    // 40 bougies pseudo-aléatoires déterministes.
    const candles: Candle[] = [];
    for (let i = 0; i < 40; i++) {
      const base = 100 + Math.sin(i * 0.7) * 8;
      candles.push(candle(i, base + 2, base - 2, base + Math.cos(i) * 1.5));
    }
    const { series } = computeIndicator(ultimateOsc, candles);
    const out = series.uo;
    if (out === undefined) throw new Error("série uo absente");

    expect(out.length).toBe(candles.length);
    // slow = 28 : première valeur à l'index 28, avant -> undefined.
    for (let i = 0; i < 28; i++) expect(out[i]).toBeUndefined();
    for (let i = 28; i < candles.length; i++) {
      const v = out[i];
      expect(v).toBeDefined();
      if (v === undefined) continue;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it("hausse stricte fermant au plus haut -> UO = 100", () => {
    // Chaque barre : close = high, low au-dessus de la clôture précédente.
    // BP = close - min(low, closePrev) = close - closePrev ; TR = high - closePrev
    // = close - closePrev -> BP == TR -> chaque moyenne = 1 -> UO = 100.
    const candles: Candle[] = [];
    let close = 100;
    for (let i = 0; i < 35; i++) {
      const low = close + 1; // strictement au-dessus de la clôture précédente
      const next = low + 1;
      candles.push(candle(i, next, low, next));
      close = next;
    }
    const { series } = computeIndicator(ultimateOsc, candles, { fast: 7, mid: 14, slow: 28 });
    const out = series.uo;
    if (out === undefined) throw new Error("série uo absente");
    for (let i = 28; i < candles.length; i++) {
      expect(out[i]).toBeCloseTo(100, 9);
    }
  });
});
