/**
 * @axiom/indicators — volatility/choppiness.ts
 *
 * Choppiness Index (E.W. Dreiss) — range vs path :
 *   CI = 100 · log10( sum(TR, n) / (maxH − minL) ) / log10(n)
 * Proche de 100 = marché choppy (range) ; proche de 0 = tendance forte.
 * Seuils usuels : > 61,8 range ; < 38,2 tendance.
 */

import type { IndicatorDef } from "@axiom/types";
import { trueRange } from "../utils";

export const choppiness: IndicatorDef = {
  id: "choppiness",
  name: "Choppiness Index",
  category: "volatility",
  pane: "separate",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 14, min: 2, max: 200 },
  ],
  outputs: [{ key: "chop", name: "CHOP", style: "line" }],
  precision: 1,
  calc(candles, params) {
    const length = Math.max(2, Math.floor(Number(params.length) || 14));
    const tr = trueRange(candles);
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    const logN = Math.log10(length);
    if (logN === 0) return { series: { chop: out } };

    for (let i = length - 1; i < n; i++) {
      let sumTr = 0;
      let maxH = -Infinity;
      let minL = Infinity;
      let ok = true;
      for (let k = 0; k < length; k++) {
        const idx = i - length + 1 + k;
        const c = candles[idx];
        const t = tr[idx];
        if (c === undefined || t === undefined) {
          ok = false;
          break;
        }
        sumTr += t;
        if (c.high > maxH) maxH = c.high;
        if (c.low < minL) minL = c.low;
      }
      if (!ok) continue;
      const range = maxH - minL;
      if (range <= 0) {
        out[i] = 100; // pas de range = pure chop / flat
        continue;
      }
      out[i] = (100 * Math.log10(sumTr / range)) / logN;
    }
    return { series: { chop: out } };
  },
};
