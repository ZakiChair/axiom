/** Offre en profit : ratio 100×sp/(sp+sl), somme ≤ 0 ou jambe absente → undefined. */
import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { offreEnProfit } from "./offreEnProfit";

const candles = (n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => ({ time: i, open: 1, high: 1, low: 1, close: 1, volume: 1 }));

describe("offreEnProfit", () => {
  it("calcule le pourcentage ; somme ≤ 0 ou jambe absente → undefined", () => {
    const r = offreEnProfit.calc(candles(4), {}, {
      hl2: [], hlc3: [], ohlc4: [], source: [],
      aux: {
        supplyProfit: [15, 8, 0, undefined],
        supplyLoss: [5, 8, 0, 1],
      },
    });
    expect(r.series.pct?.[0]).toBe(75); // 15 / 20
    expect(r.series.pct?.[1]).toBe(50); // 8 / 16
    expect(r.series.pct?.[2]).toBeUndefined(); // somme 0
    expect(r.series.pct?.[3]).toBeUndefined(); // jambe absente
  });
  it("aux absent ou une seule jambe → all-undefined", () => {
    const r = offreEnProfit.calc(candles(2), {}, {
      hl2: [], hlc3: [], ohlc4: [], source: [],
      aux: { supplyProfit: [1, 2] },
    });
    expect(r.series.pct).toEqual([undefined, undefined]);
  });
});
