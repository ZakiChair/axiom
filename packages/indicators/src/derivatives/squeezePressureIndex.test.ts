import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { squeezePressureIndex } from "./squeezePressureIndex";

function makeCandles(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    time: 1000 + i * 3600_000,
    open: 100,
    high: 102,
    low: 98,
    close: 100,
    volume: 1000,
  }));
}

describe("squeezePressureIndex", () => {
  it("calcule un score SPI cohérent lors d'un pic de funding", () => {
    const candles = makeCandles(20);
    // 19 points à 0.0001, puis un point extrême à 0.001
    const funding = new Array(19).fill(0.0001);
    funding.push(0.001);

    const aux = {
      funding,
    };

    const res = computeIndicator(squeezePressureIndex, candles, { window: 15, atrPeriod: 5 }, aux);
    const spi = res.series.spi;
    expect(spi).toBeDefined();
    // Le dernier point doit être positif (Z-score élevé / ATR%)
    const dernier = spi![19];
    expect(dernier).toBeDefined();
    expect(dernier!).toBeGreaterThan(0.5);
  });

  it("gère l'absence de funding sans planter", () => {
    const candles = makeCandles(10);
    const res = computeIndicator(squeezePressureIndex, candles, {});
    expect(res.series.spi).toBeDefined();
    expect(res.series.spi!.every((v) => v === undefined)).toBe(true);
  });
});
