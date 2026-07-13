import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { linreg } from "./linreg";

describe("linreg", () => {
  it("tendance linéaire croissante : mid proche de la dernière clôture", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 50; i++) {
      const close = 100 + i;
      candles.push({
        time: i * 60_000,
        open: close,
        high: close,
        low: close,
        close,
        volume: 1,
      });
    }
    const { series } = linreg.calc(
      candles,
      { length: 20, mult: 2 },
      { hl2: [], hlc3: [], ohlc4: [], source: candles.map((c) => c.close) },
    );
    const last = candles[49]!.close;
    expect(series.mid?.[49]).toBeCloseTo(last, 5);
    expect(series.upper?.[49]).toBeGreaterThanOrEqual(series.mid?.[49] ?? 0);
    expect(series.lower?.[49]).toBeLessThanOrEqual(series.mid?.[49] ?? 0);
  });

  it("undefined avant la fenêtre pleine", () => {
    const candles: Candle[] = Array.from({ length: 5 }, (_, i) => ({
      time: i,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 1,
    }));
    const { series } = linreg.calc(
      candles,
      { length: 20, mult: 2 },
      { hl2: [], hlc3: [], ohlc4: [], source: [1, 1, 1, 1, 1] },
    );
    expect(series.mid?.every((v) => v === undefined)).toBe(true);
  });
});
