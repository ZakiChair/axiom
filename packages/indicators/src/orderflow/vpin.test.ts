import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { vpin } from "./vpin";

function ctxDe(candles: Candle[]) {
  return { hl2: [], hlc3: [], ohlc4: [], source: candles.map((c) => c.close) };
}

/** Barre de volume 1 avec un split taker donné (buy + sell = 1). */
function barre(i: number, buy: number): Candle {
  return { time: i, open: 100, high: 100, low: 100, close: 100, volume: 1, buyVolume: buy, sellVolume: 1 - buy };
}

describe("vpin", () => {
  it("tout acheteur : chaque bucket est à |b−s|/(b+s) = 1 → VPIN = 1", () => {
    const candles: Candle[] = Array.from({ length: 20 }, (_, i) => barre(i, 1));
    const { series } = vpin.calc(candles, { length: 10, buckets: 5 }, ctxDe(candles));
    expect(series.vpin?.[19]).toBeCloseTo(1, 12);
    expect(series.seuil?.[19]).toBe(0.5);
  });

  it("split équilibré : VPIN = 0", () => {
    const candles: Candle[] = Array.from({ length: 20 }, (_, i) => barre(i, 0.5));
    const { series } = vpin.calc(candles, { length: 10, buckets: 5 }, ctxDe(candles));
    expect(series.vpin?.[19]).toBeCloseTo(0, 12);
  });

  it("9 barres acheteuses puis 1 vendeuse, 2 buckets : VPIN = (1 + 0,6)/2 = 0,8", () => {
    // Volume total 10, bucket = 5 : le premier porte les barres 1-5 (acheteuses,
    // |Δ|=1) ; le second les barres 6-10 (4 acheteuses + 1 vendeuse, |Δ|=3/5).
    const candles: Candle[] = [...Array.from({ length: 9 }, (_, i) => barre(i, 1)), barre(9, 0)];
    const { series } = vpin.calc(candles, { length: 10, buckets: 2 }, ctxDe(candles));
    expect(series.vpin?.[9]).toBeCloseTo(0.8, 12);
  });

  it("split taker absent : fenêtre invalidée, aucun zéro fabriqué", () => {
    const candles: Candle[] = Array.from({ length: 20 }, (_, i) => ({
      time: i,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      volume: 1,
    }));
    const { series } = vpin.calc(candles, { length: 10, buckets: 5 }, ctxDe(candles));
    expect(series.vpin?.[19]).toBeUndefined();
  });

  it("une seule barre à volume nul invalide la fenêtre (pas de bucket fantôme)", () => {
    const candles: Candle[] = Array.from({ length: 20 }, (_, i) =>
      i === 15 ? { time: i, open: 100, high: 100, low: 100, close: 100, volume: 0, buyVolume: 0, sellVolume: 0 } : barre(i, 0.7),
    );
    const { series } = vpin.calc(candles, { length: 10, buckets: 5 }, ctxDe(candles));
    expect(series.vpin?.[19]).toBeUndefined();
    expect(series.vpin?.[14]).toBeCloseTo(0.4, 12); // fenêtre 5-14, split 0,7/0,3
  });
});
