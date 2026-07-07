/**
 * @axiom/indicators — volume/volumeOsc.test.ts
 *
 * Volume Oscillator : composite de deux EMA de volume -> propriétés
 * (longueur, amorçage undefined avant long-1, finitude).
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { volumeOsc } from "./volumeOsc";

function candle(vol: number): Candle {
  return { time: 0, open: 1, high: 1, low: 1, close: 1, volume: vol };
}

const ctx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

const candles: Candle[] = Array.from({ length: 15 }, (_, i) =>
  candle(100 + ((i * 37) % 50))
);

describe("volumeOsc", () => {
  it("amorçage undefined avant l'index long-1 puis valeurs finies", () => {
    const long = 10;
    const res = volumeOsc.calc(candles, { short: 5, long }, ctx);
    const s = res.series.volumeOsc!;
    for (let i = 0; i < long - 1; i++) expect(s[i]).toBeUndefined();
    for (let i = long - 1; i < s.length; i++) expect(Number.isFinite(s[i])).toBe(true);
  });

  it("longueur de sortie = longueur d'entrée", () => {
    const res = volumeOsc.calc(candles, {}, ctx);
    expect(res.series.volumeOsc).toHaveLength(candles.length);
  });

  it("métadonnées conformes", () => {
    expect(volumeOsc.id).toBe("volumeOsc");
    expect(volumeOsc.pane).toBe("separate");
  });
});
