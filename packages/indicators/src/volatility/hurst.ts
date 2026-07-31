/**
 * @axiom/indicators — volatility/hurst.ts
 *
 * Exposant de Hurst (analyse R/S rescaled range) — mesure la persistance d'une série :
 *   H ≈ 0.5  marche aléatoire (pas de mémoire) ;
 *   H > 0.5  série PERSISTANTE / tendancielle (les mouvements se prolongent) ;
 *   H < 0.5  série ANTI-persistante / à retour à la moyenne.
 *
 * Estimation R/S à une échelle sur une fenêtre glissante de `window` log-rendements :
 *   1. r_k = ln(close_k / close_{k-1}) sur la fenêtre ; m = moyenne des r_k.
 *   2. Z_t = Σ_{k≤t} (r_k − m)  (déviation cumulée) ; R = max(Z) − min(Z).
 *   3. S = écart-type (population) des r_k.
 *   4. H = ln(R/S) / ln(window)   (défini si S>0 et R>0).
 * `undefined` tant que la fenêtre de rendements est incomplète. PURE (OHLCV seul).
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf } from "../utils";

export const hurst: IndicatorDef = {
  id: "hurst",
  name: "Exposant de Hurst",
  category: "volatility",
  pane: "separate",
  precision: 3,
  inputs: [{ key: "window", name: "Fenêtre", type: "number", default: 100, min: 20, max: 400 }],
  outputs: [{ key: "hurst", name: "Hurst", style: "line" }],
  calc(candles, params, _ctx) {
    const n = candles.length;
    const window = Math.max(20, Math.floor(Number(params.window ?? 100)));
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (n < window + 1) return { series: { hurst: out } };

    const close = closeOf(candles);
    // Log-rendements alignés sur l'index i (r[i] = ln(close[i]/close[i-1])), r[0] absent.
    const ret = new Array<number | undefined>(n).fill(undefined);
    for (let i = 1; i < n; i++) {
      const c0 = close[i - 1];
      const c1 = close[i];
      if (c0 !== undefined && c1 !== undefined && c0 > 0 && c1 > 0) {
        ret[i] = Math.log(c1 / c0);
      }
    }

    const lnWindow = Math.log(window);
    for (let i = window; i < n; i++) {
      // Fenêtre des `window` derniers rendements (indices i-window+1..i).
      const win: number[] = [];
      for (let j = i - window + 1; j <= i; j++) {
        const r = ret[j];
        if (r === undefined) break;
        win.push(r);
      }
      if (win.length < window) continue;

      const mean = win.reduce((a, b) => a + b, 0) / win.length;
      let cum = 0;
      let maxZ = -Infinity;
      let minZ = Infinity;
      let varSum = 0;
      for (const r of win) {
        const dev = r - mean;
        cum += dev;
        if (cum > maxZ) maxZ = cum;
        if (cum < minZ) minZ = cum;
        varSum += dev * dev;
      }
      const range = maxZ - minZ;
      const sd = Math.sqrt(varSum / win.length);
      if (sd <= 0 || range <= 0) continue;
      out[i] = Math.log(range / sd) / lnWindow;
    }

    return { series: { hurst: out } };
  },
};
