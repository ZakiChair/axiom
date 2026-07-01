import { describe, expect, it } from "vitest";
import { buildMacroValueByTime, scaleMacroSeries } from "./macro";

const day = 24 * 60 * 60 * 1000;

describe("macro chart alignment", () => {
  it("forward-fills low-frequency macro values on candle timestamps", () => {
    const candles = [{ time: 2 * day }, { time: 3 * day }, { time: 4 * day }];
    const series = [
      { time: 1 * day, value: 100 },
      { time: 3 * day, value: 120 },
    ];

    expect(buildMacroValueByTime(candles, series)).toEqual({
      [2 * day]: 100,
      [3 * day]: 120,
      [4 * day]: 120,
    });
  });

  it("renders a single macro snapshot across the whole visible candle window", () => {
    const candles = [{ time: 2 * day }, { time: 3 * day }, { time: 4 * day }];

    expect(buildMacroValueByTime(candles, [{ time: 4 * day, value: 2_400 }])).toEqual({
      [2 * day]: 2_400,
      [3 * day]: 2_400,
      [4 * day]: 2_400,
    });
  });

  it("rescales FRED M2 billions into absolute USD before plotting", () => {
    expect(scaleMacroSeries([{ time: 1, value: 21_000 }], 1e9)).toEqual([
      { time: 1, value: 21_000_000_000_000 },
    ]);
  });
});
