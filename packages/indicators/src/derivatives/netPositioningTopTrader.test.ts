import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { netPositioningTopTrader } from "./netPositioningTopTrader";

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

describe("netPositioningTopTrader", () => {
  it("calcule le net % des top traders", () => {
    const candles = makeCandles(3);
    const aux = {
      lsTopTrader: [1.5, 1.0, 0.5],
    };
    // 1.5 -> (0.5 / 2.5) * 100 = 20%
    // 1.0 -> 0%
    // 0.5 -> (-0.5 / 1.5) * 100 = -33.3333%
    const res = computeIndicator(netPositioningTopTrader, candles, {}, aux);
    const npiTop = res.series.npiTop;
    expect(npiTop).toBeDefined();
    expect(npiTop![0]).toBeCloseTo(20, 4);
    expect(npiTop![1]).toBeCloseTo(0, 4);
    expect(npiTop![2]).toBeCloseTo(-33.3333, 4);
  });
});
