/**
 * @axiom/indicators — volume/obv.ts
 *
 * OBV (On Balance Volume) — Joe Granville.
 * Source : Granville, "New Key to Stock Market Profits" (1963) ; cf. StockCharts/
 * TradingView `ta.obv` = cum(sign(change(close)) * volume).
 *
 * Formule cumulative :
 *   obv[0] = 0                       (aucune clôture précédente)
 *   obv[i] = obv[i-1] + signe(close[i] - close[i-1]) * volume[i]
 *            avec signe(>0)=+1, signe(<0)=-1, signe(0)=0
 *
 * Indicateur cumulatif : défini dès la première bougie (aucun amorçage undefined).
 */

import type { Candle, IndicatorDef } from "@axiom/types";
import { closeOf, volOf } from "../utils";

/**
 * Cœur de calcul de l'OBV, extrait pour être réutilisé par les defs de
 * divergence (Task 7) comme oscillateur source. Comportement identique à
 * l'ancien corps inline d'`obv.calc`. PURE.
 */
export function obvOf(candles: Candle[]): Array<number | undefined> {
  const close = closeOf(candles);
  const vol = volOf(candles);
  const n = candles.length;
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  if (n === 0) return out;

  let acc = 0;
  out[0] = 0;
  for (let i = 1; i < n; i++) {
    const c = close[i];
    const p = close[i - 1];
    const v = vol[i];
    if (c === undefined || p === undefined || v === undefined) {
      out[i] = acc; // bougie manquante : pas de variation
      continue;
    }
    const sign = c > p ? 1 : c < p ? -1 : 0;
    acc += sign * v;
    out[i] = acc;
  }
  return out;
}

export const obv: IndicatorDef = {
  id: "obv",
  name: "On Balance Volume",
  category: "volume",
  pane: "separate",
  inputs: [],
  outputs: [{ key: "obv", name: "OBV", style: "line" }],
  calc(candles) {
    return { series: { obv: obvOf(candles) } };
  },
};
