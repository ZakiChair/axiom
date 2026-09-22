/** Liquidations par bougie (Coinalyze) : signe des histogrammes, net, garde aux. */
import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { liqParBougie } from "./liqParBougie";

const candles = (n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => ({ time: i, open: 1, high: 1, low: 1, close: 1, volume: 1 }));

describe("liqParBougie", () => {
  it("shorts positifs, longs en négatif, net = shorts − longs", () => {
    const r = liqParBougie.calc(candles(3), {}, {
      hl2: [], hlc3: [], ohlc4: [], source: [],
      aux: { liqLongUsd: [100, undefined, 40], liqShortUsd: [50, 20, 10] },
    });
    expect(r.series.shorts).toEqual([50, 20, 10]);
    expect(r.series.longs).toEqual([-100, 0, -40]);
    expect(r.series.net).toEqual([-50, 20, -30]);
  });

  it("les deux jambes absentes à un index → toutes les sorties undefined", () => {
    const r = liqParBougie.calc(candles(2), {}, {
      hl2: [], hlc3: [], ohlc4: [], source: [],
      aux: { liqLongUsd: [undefined, 5], liqShortUsd: [undefined, undefined] },
    });
    expect(r.series.net?.[0]).toBeUndefined();
    expect(r.series.net?.[1]).toBe(5 * -1);
  });

  it("aux absent → séries all-undefined", () => {
    const r = liqParBougie.calc(candles(2), {}, { hl2: [], hlc3: [], ohlc4: [], source: [] });
    expect(r.series.shorts).toEqual([undefined, undefined]);
  });
});
