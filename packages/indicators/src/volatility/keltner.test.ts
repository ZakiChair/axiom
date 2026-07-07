/**
 * Test unitaire — Keltner Channels.
 * Propriétés (pas de fausse précision : EMA + ATR de Wilder) :
 *  - 3 séries alignées sur les bougies ;
 *  - amorçage undefined ;
 *  - ordre des canaux : upper >= basis >= lower (mult >= 0).
 */

import { describe, it, expect } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { keltner } from "./keltner";

/** Bougies OHLC déterministes (marche montante avec amplitude). */
function makeCandles(count: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const base = 100 + i * 0.5 + (i % 3) - 1;
    out.push({
      time: i * 60_000,
      open: base,
      high: base + 2,
      low: base - 2,
      close: base + 0.5,
      volume: 10,
    });
  }
  return out;
}

const ctx: CalcContext = { hl2: [], hlc3: [], ohlc4: [], source: [] };

describe("keltner", () => {
  const candles = makeCandles(60);
  const { series } = keltner.calc(
    candles,
    { emaLength: 20, atrLength: 10, mult: 2 },
    ctx
  );

  it("expose 3 séries alignées sur les bougies", () => {
    expect(Object.keys(series).sort()).toEqual(["basis", "lower", "upper"]);
    expect(series.basis).toHaveLength(60);
    expect(series.upper).toHaveLength(60);
    expect(series.lower).toHaveLength(60);
  });

  it("laisse undefined avant amorçage (EMA non amorcée)", () => {
    expect(series.basis?.[0]).toBeUndefined();
    expect(series.upper?.[18]).toBeUndefined();
  });

  it("respecte l'ordre upper >= basis >= lower là où défini", () => {
    for (let i = 0; i < 60; i++) {
      const b = series.basis?.[i];
      const u = series.upper?.[i];
      const l = series.lower?.[i];
      if (b === undefined || u === undefined || l === undefined) continue;
      expect(u).toBeGreaterThanOrEqual(b);
      expect(b).toBeGreaterThanOrEqual(l);
    }
  });
});
