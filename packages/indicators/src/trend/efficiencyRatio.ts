/**
 * @axiom/indicators — trend/efficiencyRatio.ts
 *
 * Efficiency Ratio de Kaufman (composante du KAMA) :
 *   ER = |close − close[n]| / sum(|Δclose|)  ∈ [0, 1]
 * Proche de 1 = mouvement directionnel efficace ; proche de 0 = bruit.
 * Filtre de régime avant d'empiler des signaux de tendance.
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf } from "../utils";

export const efficiencyRatio: IndicatorDef = {
  id: "efficiencyRatio",
  name: "Efficiency Ratio (Kaufman)",
  category: "trend",
  pane: "separate",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 10, min: 2, max: 200 },
  ],
  outputs: [{ key: "er", name: "ER", style: "line" }],
  precision: 3,
  calc(candles, params) {
    const length = Math.max(2, Math.floor(Number(params.length) || 10));
    const close = closeOf(candles);
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = length; i < n; i++) {
      const c0 = close[i - length];
      const c1 = close[i];
      if (c0 === undefined || c1 === undefined) continue;
      const change = Math.abs(c1 - c0);
      let volatility = 0;
      let ok = true;
      for (let k = 0; k < length; k++) {
        const a = close[i - length + 1 + k];
        const b = close[i - length + k];
        if (a === undefined || b === undefined) {
          ok = false;
          break;
        }
        volatility += Math.abs(a - b);
      }
      if (!ok) continue;
      out[i] = volatility === 0 ? 0 : change / volatility;
    }
    return { series: { er: out } };
  },
};
