import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { chandelierExit } from "./chandelierExit";

describe("chandelierExit", () => {
  it("stop long sous le high, stop short au-dessus du low", () => {
    const candles: Candle[] = Array.from({ length: 40 }, (_, i) => ({
      time: i,
      open: 100,
      high: 105,
      low: 95,
      close: 100,
      volume: 1,
    }));
    const { series } = chandelierExit.calc(
      candles,
      { length: 22, mult: 3 },
      { hl2: [], hlc3: [], ohlc4: [], source: candles.map((c) => c.close) },
    );
    const long = series.long?.[39];
    const short = series.short?.[39];
    expect(long).toBeDefined();
    expect(short).toBeDefined();
    expect(long!).toBeLessThan(105);
    expect(short!).toBeGreaterThan(95);
  });
});
