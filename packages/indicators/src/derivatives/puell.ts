/**
 * @axiom/indicators — derivatives/puell.ts
 *
 * Puell Multiple — revenu quotidien des mineurs (USD) rapporté à sa moyenne mobile
 * 365 j : mesure la pression vendeuse des mineurs relative à l'historique.
 *   < 0.5  zone d'accumulation (creux de cycle) ;  > 4  zone de distribution (sommets).
 *
 * Série aux `puell` (bitcoin-data.com / BGeometrics, journalier, BTC uniquement,
 * gratuit). Recopie directe : moteur pur, lecture défensive de ctx.aux.
 */

import type { IndicatorDef } from "@axiom/types";

export const puell: IndicatorDef = {
  id: "puell",
  name: "Puell Multiple",
  category: "derivatives",
  pane: "separate",
  aux: ["puell"],
  minTimeframe: "1d",
  precision: 3,
  inputs: [],
  outputs: [{ key: "puell", name: "Puell Multiple", style: "line" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const series = ctx.aux?.puell;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (series) {
      for (let i = 0; i < n; i++) out[i] = series[i];
    }
    return { series: { puell: out } };
  },
};
