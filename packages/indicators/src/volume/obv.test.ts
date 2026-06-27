/**
 * @axiom/indicators — volume/obv.test.ts
 *
 * OBV : indicateur cumulatif linéaire -> valeurs exactes calculées à la main.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { obv } from "./obv";

function candle(close: number, vol: number): Candle {
  return { time: 0, open: close, high: close, low: close, close, volume: vol };
}

const ctx = { hl2: [], hlc3: [], ohlc4: [] };

// closes : 100,102,101,101,105 ; vols : 10,5,8,3,20
const candles: Candle[] = [
  candle(100, 10),
  candle(102, 5),
  candle(101, 8),
  candle(101, 3),
  candle(105, 20),
];

describe("obv", () => {
  it("cumule ±volume selon le signe de change(close) — valeurs exactes", () => {
    // obv0=0 ; +5=5 ; -8=-3 ; 0=-3 (close égal) ; +20=17
    const res = obv.calc(candles, {}, ctx);
    expect(res.series.obv).toEqual([0, 5, -3, -3, 17]);
  });

  it("est défini dès la première bougie (cumulatif, pas d'amorçage undefined)", () => {
    const res = obv.calc(candles, {}, ctx);
    expect(res.series.obv?.[0]).toBe(0);
    expect(res.series.obv?.every((v) => v !== undefined)).toBe(true);
  });

  it("renvoie une série de même longueur que l'entrée", () => {
    const res = obv.calc(candles, {}, ctx);
    expect(res.series.obv).toHaveLength(candles.length);
  });

  it("métadonnées conformes", () => {
    expect(obv.id).toBe("obv");
    expect(obv.category).toBe("volume");
    expect(obv.pane).toBe("separate");
  });
});
