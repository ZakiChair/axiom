import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { waddahAttar } from "./waddahAttar";

describe("waddahAttar", () => {
  it("explosion > 0 et up/down non négatifs", () => {
    const candles: Candle[] = Array.from({ length: 80 }, (_, i) => ({
      time: i,
      open: 100 + i * 0.2,
      high: 101 + i * 0.2,
      low: 99 + i * 0.2,
      close: 100.5 + i * 0.2,
      volume: 1,
    }));
    const { series } = waddahAttar.calc(
      candles,
      { fast: 20, slow: 40, bbLength: 20, bbMult: 2, sensitivity: 150 },
      { hl2: [], hlc3: [], ohlc4: [], source: candles.map((c) => c.close) },
    );
    expect(series.explosion?.[79]).toBeGreaterThan(0);
    expect(series.up?.[79]).toBeGreaterThanOrEqual(0);
    expect(series.down?.[79]).toBeGreaterThanOrEqual(0);
  });
});
