import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { garmanKlassVol } from "./garmanKlassVol";

/** Barres à range constant : H=102, L=98, O=C=100 (aucun mouvement de prix). */
function barresRangeConstant(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    time: i,
    open: 100,
    high: 102,
    low: 98,
    close: 100,
    volume: 1,
  }));
}

function ctxDe(candles: Candle[]) {
  return { hl2: [], hlc3: [], ohlc4: [], source: candles.map((c) => c.close) };
}

describe("garmanKlassVol", () => {
  it("range constant (H=102, L=98, O=C=100) : σ² = 0,5·ln(H/L)²", () => {
    // σ² = 0,5·ln(102/98)² = 0,000800213… ; annualisé ×√365 → 54,0442 %
    const candles = barresRangeConstant(30);
    const { series } = garmanKlassVol.calc(candles, { length: 20, periodsPerYear: 365 }, ctxDe(candles));
    expect(series.vol?.[19]).toBeCloseTo(54.0442, 3);
    expect(series.vol?.[18]).toBeUndefined(); // fenêtre incomplète
  });

  it("bougie incohérente (clôture hors du range) : terme borné à 0, jamais négatif", () => {
    // O=100, C=120, H=110,5, L=99,9 : 0,5·ln(H/L)² − 0,386·ln(C/O)² < 0.
    const candles: Candle[] = Array.from({ length: 20 }, (_, i) => ({
      time: i,
      open: 100,
      high: 110.5,
      low: 99.9,
      close: 120,
      volume: 1,
    }));
    const { series } = garmanKlassVol.calc(candles, { length: 20, periodsPerYear: 365 }, ctxDe(candles));
    expect(series.vol?.[19]).toBe(0);
  });

  it("prix non positifs : barre ignorée, fenêtre incomplète", () => {
    const candles = barresRangeConstant(30);
    candles[25] = { ...candles[25]!, low: 0 };
    const { series } = garmanKlassVol.calc(candles, { length: 20, periodsPerYear: 365 }, ctxDe(candles));
    expect(series.vol?.[29]).toBeUndefined();
    expect(series.vol?.[24]).toBeCloseTo(54.0442, 3); // fenêtre s'arrêtant avant la barre cassée
  });
});
