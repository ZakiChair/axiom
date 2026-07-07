/**
 * @axiom/indicators — volume/pvt.test.ts
 *
 * PVT : cumul de vol*ROC(close,1), linéaire -> valeurs exactes calculées à la main.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { pvt } from "./pvt";

function candle(close: number, vol: number): Candle {
  return { time: 0, open: close, high: close, low: close, close, volume: vol };
}

const ctx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

// closes : 100,200,100 ; vols : 3,4,5 (ROC exacts : +1.0 puis -0.5)
const candles: Candle[] = [candle(100, 3), candle(200, 4), candle(100, 5)];

describe("pvt", () => {
  it("cumule vol*ROC — valeurs exactes", () => {
    // pvt0=0 ; +4*1.0=4 ; +5*(-0.5)=-2.5 -> 1.5
    const res = pvt.calc(candles, {}, ctx);
    const s = res.series.pvt!;
    expect(s[0]).toBe(0);
    expect(s[1]).toBeCloseTo(4, 12);
    expect(s[2]).toBeCloseTo(1.5, 12);
  });

  it("est défini dès la première bougie (cumulatif)", () => {
    const res = pvt.calc(candles, {}, ctx);
    expect(res.series.pvt?.every((v) => v !== undefined)).toBe(true);
  });

  it("longueur de sortie = longueur d'entrée", () => {
    const res = pvt.calc(candles, {}, ctx);
    expect(res.series.pvt).toHaveLength(candles.length);
  });

  it("métadonnées conformes", () => {
    expect(pvt.id).toBe("pvt");
    expect(pvt.pane).toBe("separate");
  });
});
