/**
 * @axiom/indicators — trend/kst.test.ts
 *
 * Stratégie : KST est linéaire (somme pondérée de SMA de ROC) -> cas EXACT.
 * On choisit une série qui DOUBLE à chaque pas, où ROC(close, n) = (2^n - 1) * 100
 * est CONSTANT, et des SMA de longueur 1 (RCMA = ROC). Le KST devient une constante
 * calculable à la main, ce qui valide pondération (1/2/3/4) et le calcul du ROC.
 *
 * closes = [1, 2, 4, 8, 16, 32]  (chaque pas double)
 *   ROC1 = ROC(close,1) = 100   ; ROC2 = ROC(close,2) = 300 ; ROC3 = ROC(close,3) = 700
 * Params : r = [1,2,3,1], s = [1,1,1,1], signal = 1.
 *   RCMA1 = 100 (i>=1), RCMA2 = 300 (i>=2), RCMA3 = 700 (i>=3), RCMA4 = 100 (i>=1)
 *   KST   = 100*1 + 300*2 + 700*3 + 100*4 = 100 + 600 + 2100 + 400 = 3200 (i>=3)
 *   signal = SMA(KST, 1) = KST.
 */

import { describe, expect, it } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { kst } from "./kst";

function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((c, i) => ({
    time: i * 60_000,
    open: c,
    high: c,
    low: c,
    close: c,
    volume: 0,
  }));
}

const emptyCtx: CalcContext = { hl2: [], hlc3: [], ohlc4: [], source: [] };

describe("kst", () => {
  it("série doublante : KST = 3200 constant à partir de l'index 3 (exact)", () => {
    const candles = candlesFromCloses([1, 2, 4, 8, 16, 32]);
    const params = { r1: 1, r2: 2, r3: 3, r4: 1, s1: 1, s2: 1, s3: 1, s4: 1, signal: 1 };
    const { series } = kst.calc(candles, params, emptyCtx);

    expect(series.kst).toEqual([
      undefined,
      undefined,
      undefined,
      3200,
      3200,
      3200,
    ]);
    // signal = SMA(KST, 1) = KST.
    expect(series.signal).toEqual([
      undefined,
      undefined,
      undefined,
      3200,
      3200,
      3200,
    ]);
  });

  it("amorçage undefined et longueur conservée (défauts)", () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 5) * 10 + i * 0.3);
    const candles = candlesFromCloses(closes);
    const { series } = kst.calc(candles, {}, emptyCtx);
    const out = series.kst ?? [];
    const sig = series.signal ?? [];
    expect(out).toHaveLength(120);
    expect(sig).toHaveLength(120);
    expect(out[0]).toBeUndefined();
    // Le signal (SMA du KST) ne peut pas démarrer avant le KST.
    const firstKst = out.findIndex((v) => v !== undefined);
    const firstSig = sig.findIndex((v) => v !== undefined);
    expect(firstSig).toBeGreaterThan(firstKst);
  });
});
