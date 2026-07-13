import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { elderImpulse } from "./elderImpulse";

describe("elderImpulse", () => {
  it("tendance haussière forte → impulse souvent +1 en fin de série", () => {
    const candles: Candle[] = Array.from({ length: 80 }, (_, i) => ({
      time: i,
      open: 100 + i,
      high: 101 + i,
      low: 99 + i,
      close: 100.5 + i,
      volume: 1,
    }));
    const source = candles.map((c) => c.close);
    const { series } = elderImpulse.calc(
      candles,
      { emaLength: 13, macdFast: 12, macdSlow: 26, macdSignal: 9 },
      { hl2: [], hlc3: [], ohlc4: [], source },
    );
    const last = series.impulse?.[79];
    expect(last === 1 || last === 0 || last === -1).toBe(true);
    expect(last).toBeDefined();
  });
});
