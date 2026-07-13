/**
 * @axiom/indicators — trend/linreg.ts
 *
 * Régression linéaire glissante + canal ± mult · écart-type des résidus.
 *
 * Sur la fenêtre [i−length+1, i] des closes :
 *   mid  = valeur de la droite de régression à i
 *   upper/lower = mid ± mult · σ(résidus)
 *
 * Overlay (support/résistance dynamique, pente = tendance).
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf } from "../utils";

export const linreg: IndicatorDef = {
  id: "linreg",
  name: "Linear Regression Channel",
  category: "trend",
  pane: "overlay",
  inputs: [
    { key: "length", name: "Length", type: "number", default: 100, min: 5, max: 500 },
    { key: "mult", name: "σ mult", type: "number", default: 2, min: 0.5, max: 5 },
  ],
  outputs: [
    { key: "mid", name: "LinReg", style: "line" },
    { key: "upper", name: "Upper", style: "line" },
    { key: "lower", name: "Lower", style: "line" },
  ],
  calc(candles, params) {
    const length = Math.max(2, Math.floor(Number(params.length) || 100));
    const mult = Number(params.mult) || 2;
    const close = closeOf(candles);
    const n = candles.length;
    const mid: Array<number | undefined> = new Array(n).fill(undefined);
    const upper: Array<number | undefined> = new Array(n).fill(undefined);
    const lower: Array<number | undefined> = new Array(n).fill(undefined);

    // x = 0..L-1, y = closes. Formules OLS classiques.
    for (let i = length - 1; i < n; i++) {
      let sumX = 0;
      let sumY = 0;
      let sumXY = 0;
      let sumXX = 0;
      let ok = true;
      for (let k = 0; k < length; k++) {
        const y = close[i - length + 1 + k];
        if (y === undefined || !Number.isFinite(y)) {
          ok = false;
          break;
        }
        const x = k;
        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumXX += x * x;
      }
      if (!ok) continue;
      const L = length;
      const den = L * sumXX - sumX * sumX;
      if (den === 0) continue;
      const slope = (L * sumXY - sumX * sumY) / den;
      const intercept = (sumY - slope * sumX) / L;
      const yHat = intercept + slope * (L - 1);
      // σ des résidus
      let ss = 0;
      for (let k = 0; k < length; k++) {
        const y = close[i - length + 1 + k] as number;
        const pred = intercept + slope * k;
        const e = y - pred;
        ss += e * e;
      }
      const sigma = Math.sqrt(ss / L);
      mid[i] = yHat;
      upper[i] = yHat + mult * sigma;
      lower[i] = yHat - mult * sigma;
    }
    return { series: { mid, upper, lower } };
  },
};
