import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { efficiencyRatio } from "./efficiencyRatio";

describe("efficiencyRatio", () => {
  it("tendance pure → ER ≈ 1", () => {
    const candles: Candle[] = Array.from({ length: 20 }, (_, i) => ({
      time: i,
      open: 100 + i,
      high: 100 + i,
      low: 100 + i,
      close: 100 + i,
      volume: 1,
    }));
    const { series } = efficiencyRatio.calc(
      candles,
      { length: 10 },
      { hl2: [], hlc3: [], ohlc4: [], source: candles.map((c) => c.close) },
    );
    expect(series.er?.[19]).toBeCloseTo(1, 6);
  });
});
