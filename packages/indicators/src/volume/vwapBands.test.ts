/**
 * @axiom/indicators — volume/vwapBands.test.ts
 *
 * VWAP Bands : invariant d'ordre (upper ≥ basis ≥ lower), amorçage undefined
 * tant que le volume cumulé est nul, et basis = VWAP cumulée.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { vwapBands } from "./vwapBands";

function candle(high: number, low: number, close: number, vol: number): Candle {
  return { time: 0, open: close, high, low, close, volume: vol };
}

// Construit le ctx avec hlc3 comme le ferait le moteur.
function makeCtx(candles: Candle[]) {
  const hlc3 = candles.map((c) => (c.high + c.low + c.close) / 3);
  return { hl2: [], hlc3, ohlc4: [], source: [] };
}

const candles: Candle[] = [
  candle(105, 95, 100, 0), // volume nul : VWAP non définie
  candle(110, 100, 108, 50),
  candle(112, 104, 106, 30),
  candle(120, 110, 118, 80),
  candle(115, 108, 110, 20),
];

describe("vwapBands", () => {
  it("undefined tant que le volume cumulé est nul, puis défini", () => {
    const res = vwapBands.calc(candles, { mult: 1 }, makeCtx(candles));
    expect(res.series.basis?.[0]).toBeUndefined();
    expect(res.series.upper?.[0]).toBeUndefined();
    expect(res.series.lower?.[0]).toBeUndefined();
    expect(res.series.basis?.[1]).toBeDefined();
  });

  it("invariant : upper ≥ basis ≥ lower partout où c'est défini", () => {
    const res = vwapBands.calc(candles, { mult: 2 }, makeCtx(candles));
    const { basis, upper, lower } = res.series;
    for (let i = 0; i < candles.length; i++) {
      const b = basis![i];
      const u = upper![i];
      const l = lower![i];
      if (b !== undefined && u !== undefined && l !== undefined) {
        expect(u).toBeGreaterThanOrEqual(b);
        expect(b).toBeGreaterThanOrEqual(l);
      }
    }
  });

  it("basis = VWAP cumulée (vérif manuelle sur la 2e bougie)", () => {
    const res = vwapBands.calc(candles, { mult: 1 }, makeCtx(candles));
    // Seule la bougie idx1 porte du volume jusque-là : VWAP = hlc3 de idx1.
    const tp1 = (110 + 100 + 108) / 3;
    expect(res.series.basis?.[1]).toBeCloseTo(tp1, 9);
    // Une seule observation pondérée -> variance nulle -> bandes collées à la base.
    expect(res.series.upper?.[1]).toBeCloseTo(tp1, 9);
    expect(res.series.lower?.[1]).toBeCloseTo(tp1, 9);
  });

  it("longueur de sortie = longueur d'entrée", () => {
    const res = vwapBands.calc(candles, {}, makeCtx(candles));
    expect(res.series.basis).toHaveLength(candles.length);
    expect(res.series.upper).toHaveLength(candles.length);
    expect(res.series.lower).toHaveLength(candles.length);
  });

  it("métadonnées conformes", () => {
    expect(vwapBands.id).toBe("vwapBands");
    expect(vwapBands.category).toBe("volume");
    expect(vwapBands.pane).toBe("overlay");
    expect(vwapBands.outputs.map((o) => o.key)).toEqual(["basis", "upper", "lower"]);
  });
});
