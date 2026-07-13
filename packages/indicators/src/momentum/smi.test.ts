import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { smi } from "./smi";

describe("smi", () => {
  it("produit SMI et signal après amorçage", () => {
    const candles: Candle[] = Array.from({ length: 50 }, (_, i) => ({
      time: i,
      open: 100 + Math.sin(i / 3),
      high: 101 + Math.sin(i / 3),
      low: 99 + Math.sin(i / 3),
      close: 100 + Math.sin(i / 3),
      volume: 1,
    }));
    const { series } = smi.calc(
      candles,
      { length: 10, smooth1: 3, smooth2: 3, signal: 3 },
      { hl2: [], hlc3: [], ohlc4: [], source: candles.map((c) => c.close) },
    );
    expect(series.smi?.[49]).toBeDefined();
    expect(series.signal?.[49]).toBeDefined();
    expect(Math.abs(series.smi![49]!)).toBeLessThanOrEqual(150);
  });
});
