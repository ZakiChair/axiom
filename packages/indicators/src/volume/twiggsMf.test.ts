import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { twiggsMf } from "./twiggsMf";

describe("twiggsMf", () => {
  it("TMF défini et borné raisonnablement", () => {
    const candles: Candle[] = Array.from({ length: 40 }, (_, i) => ({
      time: i,
      open: 100,
      high: 102,
      low: 98,
      close: 101,
      volume: 1000 + i,
    }));
    const { series } = twiggsMf.calc(
      candles,
      { length: 21 },
      { hl2: [], hlc3: [], ohlc4: [], source: candles.map((c) => c.close) },
    );
    const v = series.tmf?.[39];
    expect(v).toBeDefined();
    expect(Math.abs(v!)).toBeLessThanOrEqual(2);
  });
});
