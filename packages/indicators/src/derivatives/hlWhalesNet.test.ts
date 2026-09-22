/** Positionnement net HL : borné [−100, +100], recopie, garde aux. */
import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { hlWhalesNet } from "./hlWhalesNet";

const candles = (n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => ({ time: i, open: 1, high: 1, low: 1, close: 1, volume: 1 }));

describe("hlWhalesNet", () => {
  it("recopie la série bornée à [−100, 100]", () => {
    const r = hlWhalesNet.calc(candles(3), {}, {
      hl2: [], hlc3: [], ohlc4: [], source: [],
      aux: { hlWhalesNet: [-12.4, undefined, 150] },
    });
    expect(r.series.net).toEqual([-12.4, undefined, 100]);
  });
  it("aux absent → all-undefined", () => {
    const r = hlWhalesNet.calc(candles(2), {}, { hl2: [], hlc3: [], ohlc4: [], source: [] });
    expect(r.series.net).toEqual([undefined, undefined]);
  });
});
