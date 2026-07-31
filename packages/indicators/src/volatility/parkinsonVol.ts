/**
 * @axiom/indicators — volatility/parkinsonVol.ts
 *
 * Volatilité de Parkinson (high-low) sur fenêtre glissante, annualisable.
 *
 *   σ_P = sqrt( (1/(4 ln 2)) · mean( ln(H/L)² ) )
 *   annualisée ≈ σ_P · sqrt(periodesParAn)
 *
 * Plus efficace que close-to-close pour la même fenêtre [acad].
 * Défaut periodesParAn = 365 (crypto 24/7) ; 252 pour actions.
 */

import type { IndicatorDef } from "@axiom/types";

const INV_4LN2 = 1 / (4 * Math.LN2);

export const parkinsonVol: IndicatorDef = {
  id: "parkinsonVol",
  name: "Volatilité de Parkinson",
  category: "volatility",
  pane: "separate",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 20, min: 2, max: 200 },
    {
      key: "periodsPerYear",
      name: "Périodes par an",
      type: "number",
      default: 365,
      min: 1,
      max: 525600,
    },
  ],
  outputs: [{ key: "vol", name: "σ ann.", style: "line" }],
  precision: 2,
  calc(candles, params) {
    const length = Math.max(2, Math.floor(Number(params.length) || 20));
    const ppy = Math.max(1, Number(params.periodsPerYear) || 365);
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    // ln(H/L)² par barre
    const hl2: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      if (c === undefined || c.low <= 0 || c.high <= 0) continue;
      const ratio = c.high / c.low;
      if (ratio <= 0) continue;
      const ln = Math.log(ratio);
      hl2[i] = ln * ln;
    }
    for (let i = length - 1; i < n; i++) {
      let sum = 0;
      let ok = true;
      for (let k = 0; k < length; k++) {
        const v = hl2[i - length + 1 + k];
        if (v === undefined) {
          ok = false;
          break;
        }
        sum += v;
      }
      if (!ok) continue;
      const mean = sum / length;
      const sigma = Math.sqrt(INV_4LN2 * mean);
      out[i] = 100 * sigma * Math.sqrt(ppy); // en % annualisé
    }
    return { series: { vol: out } };
  },
};
