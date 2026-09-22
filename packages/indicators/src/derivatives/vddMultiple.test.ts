/** VDD Multiple : recopie directe, garde aux. */
import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { vddMultiple } from "./vddMultiple";

const candles = (n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => ({ time: i, open: 1, high: 1, low: 1, close: 1, volume: 1 }));

describe("vddMultiple", () => {
  it("recopie la série, non-fini écarté", () => {
    const r = vddMultiple.calc(candles(3), {}, {
      hl2: [], hlc3: [], ohlc4: [], source: [],
      aux: { vddMultiple: [0.6, Number.NaN, 2.1] },
    });
    expect(r.series.vdd).toEqual([0.6, undefined, 2.1]);
  });
  it("aux absent → all-undefined", () => {
    const r = vddMultiple.calc(candles(2), {}, { hl2: [], hlc3: [], ohlc4: [], source: [] });
    expect(r.series.vdd).toEqual([undefined, undefined]);
  });
});
