import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { netVolume } from "./netVolume";

describe("netVolume", () => {
  it("signe selon close vs open ; cumulatif optionnel", () => {
    const candles: Candle[] = [
      { time: 1, open: 10, high: 11, low: 9, close: 11, volume: 5 },
      { time: 2, open: 11, high: 12, low: 10, close: 10, volume: 3 },
    ];
    const ctx = { hl2: [], hlc3: [], ohlc4: [], source: [11, 10] };
    const bar = netVolume.calc(candles, { cumulative: false }, ctx);
    expect(bar.series.net).toEqual([5, -3]);
    const cum = netVolume.calc(candles, { cumulative: true }, ctx);
    expect(cum.series.net).toEqual([5, 2]);
  });
});
