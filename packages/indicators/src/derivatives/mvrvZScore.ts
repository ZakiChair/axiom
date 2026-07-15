/**
 * @axiom/indicators — derivatives/mvrvZScore.ts
 *
 * MVRV Z-Score — écart de la capitalisation à la realized cap, normalisé par
 * l'écart-type de la capitalisation : (market cap − realized cap) / stdev(market cap).
 * Signal de sur/sous-évaluation cyclique de référence : extrêmes HAUTS = sommets
 * historiques (survalorisation), extrêmes BAS (< 0) = creux (sous-valorisation).
 *
 * Série aux `mvrvZ` = valeur CANONIQUE (realized-cap) de bitcoin-data.com / BGeometrics
 * (journalier, BTC uniquement, gratuit) — et non plus un z-score approximé à partir du
 * ratio MVRV. Recopie directe : le moteur reste pur (aucun fetch), lecture défensive.
 */

import type { IndicatorDef } from "@axiom/types";

export const mvrvZScore: IndicatorDef = {
  id: "mvrvZScore",
  name: "MVRV Z-Score",
  category: "derivatives",
  pane: "separate",
  aux: ["mvrvZ"],
  minTimeframe: "1d",
  precision: 2,
  inputs: [],
  outputs: [{ key: "mvrvZScore", name: "MVRV Z-Score", style: "line" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const series = ctx.aux?.mvrvZ;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (series) {
      for (let i = 0; i < n; i++) out[i] = series[i];
    }
    return { series: { mvrvZScore: out } };
  },
};
