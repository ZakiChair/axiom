import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { atrPct } from "./atrPct";

describe("atrPct", () => {
  it("produit des valeurs positives après amorçage", () => {
    const candles: Candle[] = Array.from({ length: 30 }, (_, i) => ({
      time: i,
      open: 100 + i * 0.1,
      high: 101 + i * 0.1,
      low: 99 + i * 0.1,
      close: 100 + i * 0.1,
      volume: 1,
    }));
    const { series } = atrPct.calc(
      candles,
      { length: 14 },
      { hl2: [], hlc3: [], ohlc4: [], source: candles.map((c) => c.close) },
    );
    const v = series.atrPct?.[29];
    expect(v).toBeDefined();
    expect(v!).toBeGreaterThan(0);
  });
});
