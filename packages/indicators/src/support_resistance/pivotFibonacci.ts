/**
 * @axiom/indicators — support_resistance/pivotFibonacci.ts
 *
 * Pivot Points Fibonacci.
 * Source canonique : TradingView "Pivot Points Standard", méthode Fibonacci.
 *
 *   PP    = (H + L + C) / 3
 *   range = H − L
 *   R1 = PP + 0.382·range    S1 = PP − 0.382·range
 *   R2 = PP + 0.618·range    S2 = PP − 0.618·range
 *   R3 = PP + 1.000·range    S3 = PP − 1.000·range
 *
 * SIMPLIFICATION ASSUMÉE (MVP) : H/L/C de la BOUGIE PRÉCÉDENTE (candles[i-1]),
 * pas de la session précédente. Bougie 0 -> `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";

// Niveaux de retracement Fibonacci utilisés par les pivots.
const FIB1 = 0.382;
const FIB2 = 0.618;
const FIB3 = 1.0;

export const pivotFibonacci: IndicatorDef = {
  id: "pivotFibonacci",
  name: "Pivot Points Fibonacci",
  category: "support_resistance",
  pane: "overlay",
  inputs: [],
  outputs: [
    { key: "pp", name: "PP", style: "line" },
    { key: "r1", name: "R1", style: "line" },
    { key: "s1", name: "S1", style: "line" },
    { key: "r2", name: "R2", style: "line" },
    { key: "s2", name: "S2", style: "line" },
    { key: "r3", name: "R3", style: "line" },
    { key: "s3", name: "S3", style: "line" },
  ],

  calc(candles) {
    const n = candles.length;
    const pp: Array<number | undefined> = new Array(n).fill(undefined);
    const r1: Array<number | undefined> = new Array(n).fill(undefined);
    const s1: Array<number | undefined> = new Array(n).fill(undefined);
    const r2: Array<number | undefined> = new Array(n).fill(undefined);
    const s2: Array<number | undefined> = new Array(n).fill(undefined);
    const r3: Array<number | undefined> = new Array(n).fill(undefined);
    const s3: Array<number | undefined> = new Array(n).fill(undefined);

    for (let i = 1; i < n; i++) {
      const prev = candles[i - 1];
      if (prev === undefined) continue; // garde explicite
      const h = prev.high;
      const l = prev.low;
      const c = prev.close;

      const p = (h + l + c) / 3;
      const range = h - l;
      pp[i] = p;
      r1[i] = p + FIB1 * range;
      s1[i] = p - FIB1 * range;
      r2[i] = p + FIB2 * range;
      s2[i] = p - FIB2 * range;
      r3[i] = p + FIB3 * range;
      s3[i] = p - FIB3 * range;
    }

    return { series: { pp, r1, s1, r2, s2, r3, s3 } };
  },
};
