/** MVRV STH / LTH : recopie des deux jambes, trous tolérés, garde aux. */
import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { mvrvCohortes } from "./mvrvCohortes";

const candles = (n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => ({ time: i, open: 1, high: 1, low: 1, close: 1, volume: 1 }));

describe("mvrvCohortes", () => {
  it("recopie sth/lth, undefined intercalés préservés", () => {
    const r = mvrvCohortes.calc(candles(3), {}, {
      hl2: [], hlc3: [], ohlc4: [], source: [],
      aux: { sthMvrv: [1.1, undefined, 0.9], lthMvrv: [1.5, 1.4, Number.NaN] },
    });
    expect(r.series.sth).toEqual([1.1, undefined, 0.9]);
    expect(r.series.lth).toEqual([1.5, 1.4, undefined]);
  });
  it("aux absent → all-undefined", () => {
    const r = mvrvCohortes.calc(candles(2), {}, { hl2: [], hlc3: [], ohlc4: [], source: [] });
    expect(r.series.sth).toEqual([undefined, undefined]);
  });
});
