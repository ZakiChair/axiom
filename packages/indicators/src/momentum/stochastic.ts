/**
 * @axiom/indicators — momentum/stochastic.ts
 *
 * Stochastic Oscillator (version « fast »).
 * Source : George Lane / Investopedia / pandas-ta `stoch`.
 *
 * Formule :
 *   HH = plus haut roulant des `high` sur `kLength`
 *   LL = plus bas  roulant des `low`  sur `kLength`
 *   %K[i] = 100 * (close[i] - LL[i]) / (HH[i] - LL[i])
 *   %D[i] = SMA(%K, dLength)[i]
 *
 * Borne théorique : [0, 100] (la clôture est comprise entre LL et HH de la fenêtre).
 * Si HH == LL (amplitude nulle) -> %K `undefined`.
 * Alignement : %K démarre à l'index `kLength - 1` ; %D à `kLength + dLength - 2`.
 */

import type { IndicatorDef } from "@axiom/types";
import { highOf, lowOf, closeOf, rollingHighest, rollingLowest } from "../utils";

/**
 * SMA sur une série pouvant contenir des `undefined` : ne produit une valeur que
 * lorsque les `length` éléments de la fenêtre sont tous définis.
 */
function smaOfDefined(
  values: Array<number | undefined>,
  length: number
): Array<number | undefined> {
  const n = values.length;
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  if (length <= 0) return out;

  for (let i = length - 1; i < n; i++) {
    let sum = 0;
    let ok = true;
    for (let j = i - length + 1; j <= i; j++) {
      const v = values[j];
      if (v === undefined) {
        ok = false;
        break;
      }
      sum += v;
    }
    if (ok) out[i] = sum / length;
  }
  return out;
}

export const stochastic: IndicatorDef = {
  id: "stochastic",
  name: "Stochastic",
  category: "momentum",
  pane: "separate",
  inputs: [
    { key: "kLength", name: "%K", type: "number", default: 14, min: 1 },
    { key: "dLength", name: "%D", type: "number", default: 3, min: 1 },
  ],
  outputs: [
    { key: "k", name: "%K", style: "line" },
    { key: "d", name: "%D", style: "line" },
  ],

  calc(candles, params) {
    const kLength = Number(params.kLength ?? 14);
    const dLength = Number(params.dLength ?? 3);

    const highs = highOf(candles);
    const lows = lowOf(candles);
    const closes = closeOf(candles);
    const n = closes.length;

    const hh = rollingHighest(highs, kLength);
    const ll = rollingLowest(lows, kLength);

    const k: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const h = hh[i];
      const l = ll[i];
      const c = closes[i];
      if (h === undefined || l === undefined || c === undefined) continue;
      const range = h - l;
      if (range === 0) continue; // amplitude nulle : %K non défini.
      k[i] = (100 * (c - l)) / range;
    }

    const d = smaOfDefined(k, dLength);

    return { series: { k, d } };
  },
};
