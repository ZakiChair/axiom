/**
 * @axiom/indicators — volatility/rogersSatchellVol.ts
 *
 * Volatilité de Rogers-Satchell (OHLC) sur fenêtre glissante, annualisable.
 *
 *   σ²_RS = ln(H/C)·ln(H/O) + ln(L/C)·ln(L/O)
 *   annualisée ≈ σ_RS · sqrt(periodesParAn)
 *
 * Estimateur SANS dérive : contrairement à Garman-Klass, il ne suppose pas un
 * prix sans tendance et reste valide sur une barre fortement directionnelle.
 * Contrepartie : il ignore le saut overnight (open vs clôture précédente) —
 * quasi nul en crypto 24/7, matériel sur les actions ; voir yangZhangVol pour
 * la variante qui l'ajoute.
 *
 * Le terme est TOUJOURS ≥ 0 (les deux produits partagent le signe du mouvement) :
 * aucune borne basse n'est nécessaire.
 *
 * Défaut periodesParAn = 365 (crypto 24/7) ; 252 pour actions.
 */

import type { IndicatorDef } from "@axiom/types";

export const rogersSatchellVol: IndicatorDef = {
  id: "rogersSatchellVol",
  name: "Volatilité de Rogers-Satchell",
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

    const varBarre: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      if (c === undefined) continue;
      if (!(c.high > 0) || !(c.low > 0) || !(c.open > 0) || !(c.close > 0)) continue;
      varBarre[i] =
        Math.log(c.high / c.close) * Math.log(c.high / c.open) +
        Math.log(c.low / c.close) * Math.log(c.low / c.open);
    }

    for (let i = length - 1; i < n; i++) {
      let sum = 0;
      let ok = true;
      for (let k = 0; k < length; k++) {
        const v = varBarre[i - length + 1 + k];
        if (v === undefined) {
          ok = false;
          break;
        }
        sum += v;
      }
      if (!ok) continue;
      const sigma = Math.sqrt(Math.max(0, sum / length));
      out[i] = 100 * sigma * Math.sqrt(ppy);
    }
    return { series: { vol: out } };
  },
};
