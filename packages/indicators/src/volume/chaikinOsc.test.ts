/**
 * @axiom/indicators — volume/chaikinOsc.test.ts
 *
 * Chaikin Oscillator : indicateur composite (EMA d'ADL) -> on teste les
 * propriétés (longueur, amorçage undefined, finitude), pas une fausse précision.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { chaikinOsc } from "./chaikinOsc";

function candle(high: number, low: number, close: number, vol: number): Candle {
  return { time: 0, open: close, high, low, close, volume: vol };
}

const ctx = { hl2: [], hlc3: [], ohlc4: [] };

// Jeu déterministe varié.
const candles: Candle[] = Array.from({ length: 12 }, (_, i) => {
  const base = 100 + Math.sin(i) * 5;
  return candle(base + 2, base - 2, base + Math.cos(i), 100 + i * 10);
});

describe("chaikinOsc", () => {
  it("amorçage undefined avant l'index slow-1 puis valeurs finies", () => {
    const slow = 10;
    const res = chaikinOsc.calc(candles, { fast: 3, slow }, ctx);
    const s = res.series.chaikinOsc!;
    for (let i = 0; i < slow - 1; i++) expect(s[i]).toBeUndefined();
    for (let i = slow - 1; i < s.length; i++) expect(Number.isFinite(s[i])).toBe(true);
  });

  it("longueur de sortie = longueur d'entrée", () => {
    const res = chaikinOsc.calc(candles, {}, ctx);
    expect(res.series.chaikinOsc).toHaveLength(candles.length);
  });

  it("métadonnées conformes", () => {
    expect(chaikinOsc.id).toBe("chaikinOsc");
    expect(chaikinOsc.pane).toBe("separate");
  });
});
