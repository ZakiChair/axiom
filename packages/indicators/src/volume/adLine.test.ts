/**
 * @axiom/indicators — volume/adLine.test.ts
 *
 * ADL : cumul de CLV*vol, linéaire -> valeurs exactes (dont garde h==l).
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { adLine } from "./adLine";

function candle(high: number, low: number, close: number, vol: number): Candle {
  return { time: 0, open: close, high, low, close, volume: vol };
}

const ctx = { hl2: [], hlc3: [], ohlc4: [] };

// CLV choisis pour être exacts : +1, -1, 0, puis range nul (garde).
const candles: Candle[] = [
  candle(10, 0, 10, 5), // CLV=+1 -> mfv=5  -> adl=5
  candle(10, 0, 0, 3), // CLV=-1 -> mfv=-3 -> adl=2
  candle(10, 0, 5, 8), // CLV=0  -> mfv=0  -> adl=2
  candle(5, 5, 5, 100), // h==l -> CLV=0  -> adl=2
];

describe("adLine", () => {
  it("cumule CLV*vol — valeurs exactes (et garde h==l -> 0)", () => {
    const res = adLine.calc(candles, {}, ctx);
    expect(res.series.adLine).toEqual([5, 2, 2, 2]);
  });

  it("est défini dès la première bougie (cumulatif)", () => {
    const res = adLine.calc(candles, {}, ctx);
    expect(res.series.adLine?.every((v) => v !== undefined)).toBe(true);
  });

  it("longueur de sortie = longueur d'entrée", () => {
    const res = adLine.calc(candles, {}, ctx);
    expect(res.series.adLine).toHaveLength(candles.length);
  });

  it("métadonnées conformes", () => {
    expect(adLine.id).toBe("adLine");
    expect(adLine.pane).toBe("separate");
  });
});
