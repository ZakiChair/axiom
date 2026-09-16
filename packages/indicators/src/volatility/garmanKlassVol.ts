/**
 * @axiom/indicators — volatility/garmanKlassVol.ts
 *
 * Volatilité de Garman-Klass (OHLC) sur fenêtre glissante, annualisable.
 *
 *   σ²_GK = 0,5 · ln(H/L)² − (2 ln 2 − 1) · ln(C/O)²
 *   annualisée ≈ σ_GK · sqrt(periodesParAn)
 *
 * Estimer avec quatre prix par barre est plus efficace que close-à-close pour la
 * même fenêtre [acad] ; c'est la variante « OHLC » de la famille Parkinson
 * (parkinsonVol n'utilise que high/low). Le second terme corrige la dérive
 * intra-barre portée par le corps.
 *
 * Sur des bougies COHÉRENTES (low ≤ min(O,C) ≤ max(O,C) ≤ high), le terme est
 * toujours ≥ 0 : |ln(C/O)| ≤ ln(H/L) et 0,5 > 2 ln 2 − 1. La borne à 0 ne sert donc
 * qu'aux séries incohérentes (clôture hors du range, données de source abîmées) :
 * elle évite une racine imaginaire, elle ne masque pas un cas de marché.
 *
 * Défaut periodesParAn = 365 (crypto 24/7) ; 252 pour actions.
 */

import type { IndicatorDef } from "@axiom/types";

const DEUX_LN2_MOINS_1 = 2 * Math.LN2 - 1;

export const garmanKlassVol: IndicatorDef = {
  id: "garmanKlassVol",
  name: "Volatilité de Garman-Klass",
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

    // σ² par barre : 0,5·ln(H/L)² − (2 ln 2 − 1)·ln(C/O)², borné à 0.
    const varBarre: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      if (c === undefined) continue;
      if (!(c.high > 0) || !(c.low > 0) || !(c.open > 0) || !(c.close > 0)) continue;
      const hl = Math.log(c.high / c.low);
      const co = Math.log(c.close / c.open);
      const v = 0.5 * hl * hl - DEUX_LN2_MOINS_1 * co * co;
      varBarre[i] = v > 0 ? v : 0;
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
      const sigma = Math.sqrt(sum / length);
      out[i] = 100 * sigma * Math.sqrt(ppy); // en % annualisé
    }
    return { series: { vol: out } };
  },
};
