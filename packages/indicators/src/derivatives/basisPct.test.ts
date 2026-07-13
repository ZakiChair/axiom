import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { basisPct } from "./basisPct";

describe("basisPct", () => {
  it("contango positif quand mark > close", () => {
    const candles: Candle[] = [
      { time: 0, open: 100, high: 100, low: 100, close: 100, volume: 1 },
      { time: 1, open: 100, high: 100, low: 100, close: 100, volume: 1 },
    ];
    const mark = [101, 102]; // +1% puis +2%
    const { series } = basisPct.calc(
      candles,
      {},
      { hl2: [], hlc3: [], ohlc4: [], source: [100, 100], aux: { mark } },
    );
    expect(series.basis?.[0]).toBeCloseTo(1);
    expect(series.basis?.[1]).toBeCloseTo(2);
  });

  it("sans aux mark → undefined", () => {
    const candles: Candle[] = [
      { time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ];
    const { series } = basisPct.calc(
      candles,
      {},
      { hl2: [], hlc3: [], ohlc4: [], source: [1] },
    );
    expect(series.basis?.[0]).toBeUndefined();
  });
});
