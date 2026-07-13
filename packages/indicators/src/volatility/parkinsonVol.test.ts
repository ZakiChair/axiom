import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { parkinsonVol } from "./parkinsonVol";

describe("parkinsonVol", () => {
  it("série avec range constant → vol définie et positive", () => {
    const candles: Candle[] = Array.from({ length: 30 }, (_, i) => ({
      time: i,
      open: 100,
      high: 102,
      low: 98,
      close: 100,
      volume: 1,
    }));
    const { series } = parkinsonVol.calc(
      candles,
      { length: 20, periodsPerYear: 365 },
      { hl2: [], hlc3: [], ohlc4: [], source: candles.map((c) => c.close) },
    );
    expect(series.vol?.[29]).toBeGreaterThan(0);
  });
});
