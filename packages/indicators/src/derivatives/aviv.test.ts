/** AVIV : recopie directe, garde aux. */
import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { aviv } from "./aviv";

const candles = (n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => ({ time: i, open: 1, high: 1, low: 1, close: 1, volume: 1 }));

describe("aviv", () => {
  it("recopie la série", () => {
    const r = aviv.calc(candles(2), {}, {
      hl2: [], hlc3: [], ohlc4: [], source: [],
      aux: { aviv: [0.97, 1.02] },
    });
    expect(r.series.aviv).toEqual([0.97, 1.02]);
  });
  it("aux absent → all-undefined", () => {
    const r = aviv.calc(candles(2), {}, { hl2: [], hlc3: [], ohlc4: [], source: [] });
    expect(r.series.aviv).toEqual([undefined, undefined]);
  });
});
