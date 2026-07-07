/**
 * @axiom/indicators — volume/nvi.test.ts
 *
 * NVI : ne varie que quand volume[i] < volume[i-1] -> valeurs exactes.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { nvi } from "./nvi";

function candle(close: number, vol: number): Candle {
  return { time: 0, open: close, high: close, low: close, close, volume: vol };
}

const ctx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

// closes : 100,200,150,150 ; vols : 10,5,5,20
// i1 : vol 5<10 -> roc=(200-100)/100=1.0 -> 1000+1000=2000
// i2 : vol 5<5 ? non (égal) -> inchangé 2000
// i3 : vol 20<5 ? non -> inchangé 2000
const candles: Candle[] = [
  candle(100, 10),
  candle(200, 5),
  candle(150, 5),
  candle(150, 20),
];

describe("nvi", () => {
  it("ne varie qu'en volume décroissant — valeurs exactes (départ 1000)", () => {
    const res = nvi.calc(candles, {}, ctx);
    const s = res.series.nvi!;
    expect(s[0]).toBe(1000);
    expect(s[1]).toBeCloseTo(2000, 9);
    expect(s[2]).toBeCloseTo(2000, 9);
    expect(s[3]).toBeCloseTo(2000, 9);
  });

  it("est défini dès la première bougie (cumulatif)", () => {
    const res = nvi.calc(candles, {}, ctx);
    expect(res.series.nvi?.every((v) => v !== undefined)).toBe(true);
  });

  it("longueur de sortie = longueur d'entrée", () => {
    const res = nvi.calc(candles, {}, ctx);
    expect(res.series.nvi).toHaveLength(candles.length);
  });

  it("métadonnées conformes", () => {
    expect(nvi.id).toBe("nvi");
    expect(nvi.pane).toBe("separate");
  });
});
