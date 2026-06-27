/**
 * @axiom/indicators — momentum/bop.test.ts
 *
 * BOP est linéaire et sans fenêtre : valeurs exactes calculées à la main.
 *
 *   Bar0 : o=10 h=12 l=8  c=11 -> (11-10)/(12-8) =  1/4 =  0.25
 *   Bar1 : o=11 h=13 l=10 c=10 -> (10-11)/(13-10)= -1/3 = -0.3333...
 *   Bar2 : o=10 h=15 l=9  c=14 -> (14-10)/(15-9) =  4/6 =  0.6667
 *   Bar3 : o=14 h=14 l=14 c=14 -> high == low    -> undefined
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { bop } from "./bop";

const bars: Candle[] = [
  { time: 0, open: 10, high: 12, low: 8, close: 11, volume: 100 },
  { time: 1, open: 11, high: 13, low: 10, close: 10, volume: 100 },
  { time: 2, open: 10, high: 15, low: 9, close: 14, volume: 100 },
  { time: 3, open: 14, high: 14, low: 14, close: 14, volume: 100 },
];

describe("BOP (Balance of Power)", () => {
  it("calcule des valeurs exactes et gère la bougie dégénérée", () => {
    const { series } = computeIndicator(bop, bars);
    const out = series.bop;
    if (out === undefined) throw new Error("série bop absente");

    expect(out.length).toBe(bars.length);
    expect(out[0]).toBeCloseTo(0.25, 12);
    expect(out[1]).toBeCloseTo(-1 / 3, 12);
    expect(out[2]).toBeCloseTo(4 / 6, 12);
    // high == low -> pas de valeur.
    expect(out[3]).toBeUndefined();
  });

  it("respecte la borne [-1, +1]", () => {
    const { series } = computeIndicator(bop, bars);
    const out = series.bop;
    if (out === undefined) throw new Error("série bop absente");
    for (const v of out) {
      if (v === undefined) continue;
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
