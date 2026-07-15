/**
 * @axiom/indicators — derivatives/sopr.ts
 *
 * SOPR (Spent Output Profit Ratio) — ratio prix de vente / prix d'acquisition des
 * pièces dépensées ce jour : > 1 les vendeurs réalisent un PROFIT en moyenne, < 1 une
 * PERTE. Le pivot 1 fait souvent support en bull (rebond) et résistance en bear.
 *
 * Série aux `sopr` (bitcoin-data.com / BGeometrics, journalier, BTC uniquement,
 * gratuit). Recopie directe : moteur pur, lecture défensive de ctx.aux.
 */

import type { IndicatorDef } from "@axiom/types";

export const sopr: IndicatorDef = {
  id: "sopr",
  name: "SOPR",
  category: "derivatives",
  pane: "separate",
  aux: ["sopr"],
  minTimeframe: "1d",
  precision: 4,
  inputs: [],
  outputs: [{ key: "sopr", name: "SOPR", style: "line" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const series = ctx.aux?.sopr;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (series) {
      for (let i = 0; i < n; i++) out[i] = series[i];
    }
    return { series: { sopr: out } };
  },
};
