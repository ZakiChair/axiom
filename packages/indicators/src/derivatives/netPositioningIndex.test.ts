import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { netPositioningIndex } from "./netPositioningIndex";

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

describe("netPositioningIndex", () => {
  it("calcule correctement le net % à partir du ratio foule", () => {
    const candles = makeCandles(4);
    // Ratios: 1.0 (neutre -> 0%), 3.0 (75%L/25%S -> +50%), 0.3333333 (25%L/75%S -> -50%), undefined
    const aux = {
      lsAccount: [1.0, 3.0, 1 / 3, undefined],
    };

    const res = computeIndicator(netPositioningIndex, candles, {}, aux);
    const npi = res.series.npi;
    expect(npi).toBeDefined();
    expect(npi![0]).toBeCloseTo(0, 4);
    expect(npi![1]).toBeCloseTo(50, 4);
    expect(npi![2]).toBeCloseTo(-50, 4);
    expect(npi![3]).toBeUndefined();
  });

  it("gère l'absence de série auxiliaire sans planter", () => {
    const candles = makeCandles(3);
    const res = computeIndicator(netPositioningIndex, candles, {});
    expect(res.series.npi).toEqual([undefined, undefined, undefined]);
  });

  it("applique le lissage SMA quand smooth > 1", () => {
    const candles = makeCandles(3);
    const aux = {
      lsAccount: [1.0, 3.0, 3.0], // raw: [0, 50, 50] -> sma(2): [undefined, 25, 50]
    };
    const res = computeIndicator(netPositioningIndex, candles, { smooth: 2 }, aux);
    const npi = res.series.npi;
    expect(npi![0]).toBeUndefined();
    expect(npi![1]).toBeCloseTo(25, 4);
    expect(npi![2]).toBeCloseTo(50, 4);
  });
});
