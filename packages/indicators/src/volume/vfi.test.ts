import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { vfi } from "./vfi";

describe("vfi", () => {
  it("produit une série après amorçage long", () => {
    const candles: Candle[] = Array.from({ length: 200 }, (_, i) => ({
      time: i,
      open: 100 + i * 0.1,
      high: 101 + i * 0.1,
      low: 99 + i * 0.1,
      close: 100 + i * 0.1,
      volume: 1000 + (i % 10) * 50,
    }));
    const hlc3 = candles.map((c) => (c.high + c.low + c.close) / 3);
    const { series } = vfi.calc(
      candles,
      { length: 130, coef: 0.2, vcoef: 2.5 },
      { hl2: [], hlc3, ohlc4: [], source: candles.map((c) => c.close) },
    );
    expect(series.vfi?.[199]).toBeDefined();
  });
});
