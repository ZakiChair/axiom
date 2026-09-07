import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { smartRetailSpread } from "./smartRetailSpread";

function makeCandles(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    time: 1000 + i * 3600_000,
    open: 100,
    high: 105,
    low: 95,
    close: 102,
    volume: 1000,
  }));
}

describe("smartRetailSpread", () => {
  it("calcule la différence entre le NPI top trader et le NPI foule", () => {
    const candles = makeCandles(2);
    // Foule: 3.0 -> +50% NPI
    // Top traders: 1.0 -> 0% NPI
    // Spread: 0 - 50 = -50% (Smart money plus short que la foule)
    const aux = {
      lsAccount: [3.0, 1.0],
      lsTopTrader: [1.0, 3.0],
    };
    const res = computeIndicator(smartRetailSpread, candles, {}, aux);
    const spread = res.series.spread;
    expect(spread).toBeDefined();
    expect(spread![0]).toBeCloseTo(-50, 4);
    // Bougie 2: Foule 1.0 (0%), Top 3.0 (+50%) -> Spread = +50%
    expect(spread![1]).toBeCloseTo(50, 4);
  });

  it("gère les séries manquantes", () => {
    const candles = makeCandles(2);
    const res = computeIndicator(smartRetailSpread, candles, {});
    expect(res.series.spread).toEqual([undefined, undefined]);
  });
});
