import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { oiChange } from "./oiChange";

describe("oiChange", () => {
  it("Δ% sur lookback", () => {
    const candles: Candle[] = Array.from({ length: 5 }, (_, i) => ({
      time: i,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 1,
    }));
    // OI : 100,100,100,150,150 — lookback 3 → index 3 : (150-100)/100 = 50%
    const oi = [100, 100, 100, 150, 150];
    const { series } = oiChange.calc(
      candles,
      { lookback: 3 },
      { hl2: [], hlc3: [], ohlc4: [], source: [1, 1, 1, 1, 1], aux: { oi } },
    );
    expect(series.changePct?.[3]).toBeCloseTo(50);
    expect(series.changePct?.[0]).toBeUndefined();
  });
});
