/**
 * Test unitaire — Historical Volatility.
 * Propriétés (annualisation + log-returns -> pas de fausse précision exacte) :
 *  - série alignée ;
 *  - amorçage undefined jusqu'à l'index `length` ;
 *  - HV >= 0 ;
 *  - HV nulle quand les rendements sont constants (prix en progression géométrique).
 */

import { describe, it, expect } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { historicalVol } from "./historicalVol";

function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    time: i * 60_000,
    open: close,
    high: close,
    low: close,
    close,
    volume: 0,
  }));
}

const ctx: CalcContext = { hl2: [], hlc3: [], ohlc4: [] };

describe("historicalVol", () => {
  // 30 clôtures bruitées et positives.
  const closes = Array.from({ length: 30 }, (_, i) => 100 + 5 * Math.sin(i) + i);
  const candles = candlesFromCloses(closes);
  const { series } = historicalVol.calc(candles, { length: 10, annual: 365 }, ctx);

  it("expose une série alignée sur les bougies", () => {
    expect(Object.keys(series)).toEqual(["hv"]);
    expect(series.hv).toHaveLength(30);
  });

  it("laisse undefined avant la première fenêtre pleine (index < length)", () => {
    for (let i = 0; i < 10; i++) expect(series.hv?.[i]).toBeUndefined();
    expect(series.hv?.[10]).toBeDefined();
  });

  it("reste >= 0", () => {
    for (const v of series.hv ?? []) {
      if (v !== undefined) expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it("est nulle pour des rendements log constants (progression géométrique)", () => {
    const geo = candlesFromCloses(
      Array.from({ length: 15 }, (_, i) => 100 * Math.pow(1.01, i))
    );
    const { series: s2 } = historicalVol.calc(geo, { length: 10, annual: 365 }, ctx);
    expect(s2.hv?.[14]).toBeCloseTo(0, 9);
  });
});
