import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { bucketReturns, monthlyMatrix } from "./seasonality";

function c(time: number, close: number): Candle {
  return { time, open: close, high: close, low: close, close, volume: 1 };
}

describe("bucketReturns", () => {
  it("renvoie [] pour une série vide ou une seule bougie", () => {
    expect(bucketReturns([], "monthly")).toEqual([]);
    expect(bucketReturns([c(Date.UTC(2024, 0, 1), 100)], "monthly")).toEqual([]);
  });

  it("groupe les rendements par jour UTC, lundi=0", () => {
    const candles = [
      c(Date.UTC(2024, 0, 1), 100), // lundi, pas de rendement
      c(Date.UTC(2024, 0, 2), 110), // mardi: +10 %
      c(Date.UTC(2024, 0, 3), 99),  // mercredi: -10 %
      c(Date.UTC(2024, 0, 9), 108.9), // mardi: +10 %
    ];
    const out = bucketReturns(candles, "weekday");
    expect(out).toEqual([
      // mardi: mean=(0.10+0.10)/2=0.10, median=0.10, winRate=2/2.
      { bucket: 1, mean: 0.1, median: 0.1, winRate: 1, n: 2 },
      // mercredi: mean=-0.10, median=-0.10, winRate=0/1.
      { bucket: 2, mean: -0.1, median: -0.1, winRate: 0, n: 1 },
    ]);
  });

  it("groupe les rendements par mois UTC avec médiane paire", () => {
    const candles = [
      c(Date.UTC(2024, 0, 1), 100),
      c(Date.UTC(2024, 0, 2), 110), // janvier: +10 %
      c(Date.UTC(2024, 0, 3), 99),  // janvier: -10 %
      c(Date.UTC(2024, 1, 1), 108.9), // février: +10 %
    ];
    const out = bucketReturns(candles, "monthly");
    expect(out).toEqual([
      // janvier: mean=(0.10-0.10)/2=0, median=(−0.10+0.10)/2=0, winRate=1/2.
      { bucket: 0, mean: 0, median: 0, winRate: 0.5, n: 2 },
      // février: +10 %.
      { bucket: 1, mean: 0.1, median: 0.1, winRate: 1, n: 1 },
    ]);
  });

  it("groupe les rendements horaires UTC", () => {
    const candles = [
      c(Date.UTC(2024, 0, 1, 0), 100),
      c(Date.UTC(2024, 0, 1, 1), 105), // heure 1: +5 %
      c(Date.UTC(2024, 0, 1, 2), 102.9), // heure 2: -2 %
    ];
    expect(bucketReturns(candles, "hourly")).toEqual([
      { bucket: 1, mean: 0.05, median: 0.05, winRate: 1, n: 1 },
      { bucket: 2, mean: -0.02, median: -0.02, winRate: 0, n: 1 },
    ]);
  });
});

describe("monthlyMatrix", () => {
  it("calcule le rendement du mois civil vs dernier close du mois précédent", () => {
    const candles = [
      c(Date.UTC(2024, 0, 1), 100),
      c(Date.UTC(2024, 0, 31), 110),
      c(Date.UTC(2024, 1, 29), 99),
      c(Date.UTC(2024, 2, 31), 108.9),
    ];
    expect(monthlyMatrix(candles)).toEqual([
      // janvier: 110/100-1 = +10 %.
      { year: 2024, month: 0, ret: 0.1 },
      // février: 99/110-1 = -10 %.
      { year: 2024, month: 1, ret: -0.1 },
      // mars: 108.9/99-1 = +10 %.
      { year: 2024, month: 2, ret: 0.1 },
    ]);
  });

  it("renvoie [] sans au moins deux closes mensuels", () => {
    expect(monthlyMatrix([])).toEqual([]);
    expect(monthlyMatrix([c(Date.UTC(2024, 0, 1), 100)])).toEqual([]);
  });
});
