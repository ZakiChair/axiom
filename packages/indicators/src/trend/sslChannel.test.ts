import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { sslChannel } from "./sslChannel";

describe("sslChannel", () => {
  it("tendance haussière : sslUp ≥ sslDown après amorçage", () => {
    const candles: Candle[] = Array.from({ length: 40 }, (_, i) => ({
      time: i,
      open: 100 + i,
      high: 102 + i,
      low: 99 + i,
      close: 101 + i,
      volume: 1,
    }));
    const { series } = sslChannel.calc(
      candles,
      { length: 10 },
      { hl2: [], hlc3: [], ohlc4: [], source: candles.map((c) => c.close) },
    );
    const up = series.sslUp?.[39];
    const down = series.sslDown?.[39];
    expect(up).toBeDefined();
    expect(down).toBeDefined();
    expect(up!).toBeGreaterThanOrEqual(down!);
  });
});
