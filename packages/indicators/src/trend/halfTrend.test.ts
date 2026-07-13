import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { halfTrend } from "./halfTrend";

describe("halfTrend", () => {
  it("produit une ligne et une direction ±1 sur une tendance", () => {
    const candles: Candle[] = Array.from({ length: 120 }, (_, i) => ({
      time: i,
      open: 100 + i * 0.5,
      high: 101 + i * 0.5,
      low: 99 + i * 0.5,
      close: 100.5 + i * 0.5,
      volume: 1,
    }));
    const { series } = halfTrend.calc(
      candles,
      { amplitude: 2, atrPeriod: 20 },
      { hl2: [], hlc3: [], ohlc4: [], source: candles.map((c) => c.close) },
    );
    expect(series.line?.[119]).toBeDefined();
    const dir = series.direction?.[119];
    expect(dir === 1 || dir === -1).toBe(true);
  });
});
