/**
 * @axiom/indicators — volatility/ulcerIndex.ts
 *
 * Ulcer Index (Peter Martin) — mesure de drawdown :
 *   R[i]   = 100 · (close − maxClose_n) / maxClose_n
 *   UI     = sqrt( mean( R² ) ) sur la fenêtre
 * Plus l'UI est haut, plus les retracements ont été douloureux (risque).
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf } from "../utils";

export const ulcerIndex: IndicatorDef = {
  id: "ulcerIndex",
  name: "Ulcer Index",
  category: "volatility",
  pane: "separate",
  precision: 2,
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 14, min: 2, max: 200 },
  ],
  outputs: [{ key: "ui", name: "UI", style: "line" }],
  calc(candles, params) {
    const length = Math.max(2, Math.floor(Number(params.length) || 14));
    const close = closeOf(candles);
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);

    for (let i = length - 1; i < n; i++) {
      let maxC = -Infinity;
      let sumSq = 0;
      let ok = true;
      for (let k = 0; k < length; k++) {
        const c = close[i - length + 1 + k];
        if (c === undefined) {
          ok = false;
          break;
        }
        if (c > maxC) maxC = c;
      }
      if (!ok || maxC <= 0) continue;
      for (let k = 0; k < length; k++) {
        const c = close[i - length + 1 + k]!;
        // max courant jusqu'à k dans la fenêtre (drawdown depuis pic local)
        let peak = -Infinity;
        for (let j = 0; j <= k; j++) {
          const cj = close[i - length + 1 + j]!;
          if (cj > peak) peak = cj;
        }
        const r = peak === 0 ? 0 : (100 * (c - peak)) / peak;
        sumSq += r * r;
      }
      out[i] = Math.sqrt(sumSq / length);
    }
    return { series: { ui: out } };
  },
};
