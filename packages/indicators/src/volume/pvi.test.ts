/**
 * @axiom/indicators — volume/pvi.test.ts
 *
 * PVI : ne varie que quand volume[i] > volume[i-1] -> valeurs exactes
 * (les deux branches : variation et stagnation).
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { pvi } from "./pvi";

function candle(close: number, vol: number): Candle {
  return { time: 0, open: close, high: close, low: close, close, volume: vol };
}

const ctx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

// closes : 100,200,150,300 ; vols : 10,20,5,40
// i1 : vol 20>10 -> roc=1.0 -> 1000+1000=2000
// i2 : vol 5>20 ? non -> inchangé 2000
// i3 : vol 40>5 -> roc=(300-150)/150=1.0 -> 2000+2000=4000
const candles: Candle[] = [
  candle(100, 10),
  candle(200, 20),
  candle(150, 5),
  candle(300, 40),
];

describe("pvi", () => {
  it("ne varie qu'en volume croissant — valeurs exactes (départ 1000)", () => {
    const res = pvi.calc(candles, {}, ctx);
    const s = res.series.pvi!;
    expect(s[0]).toBe(1000);
    expect(s[1]).toBeCloseTo(2000, 9);
    expect(s[2]).toBeCloseTo(2000, 9);
    expect(s[3]).toBeCloseTo(4000, 9);
  });

  it("est défini dès la première bougie (cumulatif)", () => {
    const res = pvi.calc(candles, {}, ctx);
    expect(res.series.pvi?.every((v) => v !== undefined)).toBe(true);
  });

  it("longueur de sortie = longueur d'entrée", () => {
    const res = pvi.calc(candles, {}, ctx);
    expect(res.series.pvi).toHaveLength(candles.length);
  });

  it("métadonnées conformes", () => {
    expect(pvi.id).toBe("pvi");
    expect(pvi.pane).toBe("separate");
  });
});
