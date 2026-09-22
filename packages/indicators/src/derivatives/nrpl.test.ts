/** NRPL : split profit/perte par signe, SMA du net, garde aux. */
import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { nrpl } from "./nrpl";

const candles = (n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => ({ time: i, open: 1, high: 1, low: 1, close: 1, volume: 1 }));

describe("nrpl", () => {
  it("positifs → profit, négatifs → perte, jamais de 0 fantôme", () => {
    const r = nrpl.calc(candles(4), { lissage: 2 }, {
      hl2: [], hlc3: [], ohlc4: [], source: [],
      aux: { nrplUsd: [100, -50, undefined, 30] },
    });
    expect(r.series.profit).toEqual([100, undefined, undefined, 30]);
    expect(r.series.perte).toEqual([undefined, -50, undefined, undefined]);
    // SMA(2) du net : i=3 → (−50… non : net=[100,-50,undef,30] → fenêtre [undef,30] incomplète → undefined ; i=1 : (100-50)/2=25.
    expect(r.series.sma7?.[1]).toBe(25);
    expect(r.series.sma7?.[3]).toBeUndefined();
  });
  it("aux absent → all-undefined", () => {
    const r = nrpl.calc(candles(2), {}, { hl2: [], hlc3: [], ohlc4: [], source: [] });
    expect(r.series.profit).toEqual([undefined, undefined]);
  });
});
