/**
 * @axiom/indicators — momentum/cmo.ts
 *
 * CMO (Chande Momentum Oscillator).
 * Source : Tushar Chande / Investopedia / pandas-ta `cmo` (mode somme simple).
 *
 * Formule :
 *   delta[i] = close[i] - close[i-1]
 *   Su = somme des deltas positifs sur `length`
 *   Sd = somme des |deltas| négatifs sur `length`
 *   CMO[i] = 100 * (Su - Sd) / (Su + Sd)
 *
 * Borne théorique : [-100, 100]. Si Su + Sd == 0 (aucune variation) -> `undefined`.
 * Alignement : il faut `length` deltas, soit `length + 1` bougies ; la première
 * valeur apparaît à l'index `length`.
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf, rollingSum } from "../utils";

export const cmo: IndicatorDef = {
  id: "cmo",
  name: "Chande Momentum Oscillator",
  category: "momentum",
  pane: "separate",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 9, min: 1 },
  ],
  outputs: [{ key: "cmo", name: "CMO", style: "line" }],

  calc(candles, params) {
    const length = Number(params.length ?? 9);
    const close = closeOf(candles);
    const n = close.length;

    // Gains et pertes alignés : index j -> bougie j+1 (cf. modèle RSI).
    const gains: number[] = [];
    const losses: number[] = [];
    for (let i = 1; i < n; i++) {
      const cur = close[i];
      const prev = close[i - 1];
      if (cur === undefined || prev === undefined) {
        gains.push(0);
        losses.push(0);
        continue;
      }
      const delta = cur - prev;
      gains.push(delta > 0 ? delta : 0);
      losses.push(delta < 0 ? -delta : 0);
    }

    const su = rollingSum(gains, length);
    const sd = rollingSum(losses, length);

    const out: Array<number | undefined> = new Array(n).fill(undefined);
    for (let j = 0; j < gains.length; j++) {
      const u = su[j];
      const d = sd[j];
      if (u === undefined || d === undefined) continue;
      const total = u + d;
      if (total === 0) continue; // aucune variation sur la fenêtre : CMO non défini.
      out[j + 1] = (100 * (u - d)) / total;
    }

    return { series: { cmo: out } };
  },
};
