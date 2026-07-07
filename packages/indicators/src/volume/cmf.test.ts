/**
 * @axiom/indicators — volume/cmf.test.ts
 *
 * CMF : amorçage undefined + invariant de bornes [-1,1] + une valeur exacte
 * sur petite fenêtre.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { cmf } from "./cmf";

function candle(high: number, low: number, close: number, vol: number): Candle {
  return { time: 0, open: close, high, low, close, volume: vol };
}

const ctx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

// mfv = [5, -3, 0, 0] ; vol = [5, 3, 8, 100]
const candles: Candle[] = [
  candle(10, 0, 10, 5),
  candle(10, 0, 0, 3),
  candle(10, 0, 5, 8),
  candle(5, 5, 5, 100),
];

describe("cmf", () => {
  it("amorçage undefined sur length-1 puis valeur exacte (length=2)", () => {
    const res = cmf.calc(candles, { length: 2 }, ctx);
    const s = res.series.cmf!;
    expect(s[0]).toBeUndefined();
    // idx1 : Σmfv(5-3)=2 / Σvol(5+3)=8 = 0.25
    expect(s[1]).toBeCloseTo(0.25, 12);
    // idx3 : Σmfv(0+0)=0 -> 0
    expect(s[3]).toBeCloseTo(0, 12);
  });

  it("reste borné dans [-1, 1]", () => {
    const res = cmf.calc(candles, { length: 2 }, ctx);
    for (const v of res.series.cmf!) {
      if (v !== undefined) {
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("longueur de sortie = longueur d'entrée", () => {
    const res = cmf.calc(candles, { length: 2 }, ctx);
    expect(res.series.cmf).toHaveLength(candles.length);
  });

  it("métadonnées conformes", () => {
    expect(cmf.id).toBe("cmf");
    expect(cmf.pane).toBe("separate");
  });
});
