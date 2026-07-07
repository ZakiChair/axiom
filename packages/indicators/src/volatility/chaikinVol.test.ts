/**
 * Test unitaire — Chaikin Volatility.
 * Propriétés (EMA + ROC -> pas de fausse précision exacte) :
 *  - série alignée ;
 *  - amorçage undefined jusqu'à `emaLength - 1 + rocLength` ;
 *  - valeur nulle quand l'amplitude (high - low) est constante (ROC = 0).
 */

import { describe, it, expect } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { chaikinVol } from "./chaikinVol";

const ctx: CalcContext = { hl2: [], hlc3: [], ohlc4: [], source: [] };

describe("chaikinVol", () => {
  it("expose une série alignée et amorce en undefined", () => {
    const candles: Candle[] = Array.from({ length: 40 }, (_, i) => {
      const base = 100 + i;
      const span = 2 + (i % 5); // amplitude variable
      return {
        time: i * 60_000,
        open: base,
        high: base + span,
        low: base - span,
        close: base,
        volume: 0,
      };
    });
    const { series } = chaikinVol.calc(
      candles,
      { emaLength: 10, rocLength: 10 },
      ctx
    );

    expect(Object.keys(series)).toEqual(["chaikinVol"]);
    expect(series.chaikinVol).toHaveLength(40);
    // emaLength - 1 + rocLength = 19 -> première valeur à l'index 19.
    expect(series.chaikinVol?.[18]).toBeUndefined();
    expect(series.chaikinVol?.[19]).toBeDefined();
  });

  it("vaut 0 quand l'amplitude high-low est constante", () => {
    const candles: Candle[] = Array.from({ length: 40 }, (_, i) => {
      const base = 100 + i;
      return {
        time: i * 60_000,
        open: base,
        high: base + 3, // amplitude constante = 6
        low: base - 3,
        close: base,
        volume: 0,
      };
    });
    const { series } = chaikinVol.calc(
      candles,
      { emaLength: 10, rocLength: 10 },
      ctx
    );
    expect(series.chaikinVol?.[39]).toBeCloseTo(0, 9);
  });
});
