import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { qqe } from "./qqe";

describe("qqe", () => {
  it("produit une ligne QQE bornée après amorçage", () => {
    const candles: Candle[] = Array.from({ length: 80 }, (_, i) => {
      const close = 100 + Math.sin(i / 5) * 3 + i * 0.05;
      return {
        time: i,
        open: close,
        high: close + 1,
        low: close - 1,
        close,
        volume: 1,
      };
    });
    const source = candles.map((c) => c.close);
    const { series } = qqe.calc(
      candles,
      { rsiLength: 14, sf: 5, factor: 4.236 },
      { hl2: [], hlc3: [], ohlc4: [], source },
    );
    const last = series.qqe?.[79];
    expect(last).toBeDefined();
    expect(last!).toBeGreaterThanOrEqual(0);
    expect(last!).toBeLessThanOrEqual(100);
    expect(series.fast?.[79]).toBeDefined();
    expect(series.slow?.[79]).toBeDefined();
  });
});
