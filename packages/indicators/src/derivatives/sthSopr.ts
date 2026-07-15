/**
 * @axiom/indicators — derivatives/sthSopr.ts
 *
 * STH-SOPR (Short-Term Holder SOPR) — SOPR restreint aux pièces de moins de 155 j :
 * profit/perte des mains « faibles » (traders récents). Très réactif ; la reprise du
 * pivot 1 après une purge signale souvent une reprise de la demande spéculative.
 *
 * Série aux `sthSopr` (bitcoin-data.com, journalier, BTC, gratuit). Recopie directe.
 */
import type { IndicatorDef } from "@axiom/types";

export const sthSopr: IndicatorDef = {
  id: "sthSopr",
  name: "STH-SOPR (court terme)",
  category: "derivatives",
  pane: "separate",
  aux: ["sthSopr"],
  minTimeframe: "1d",
  precision: 4,
  inputs: [],
  outputs: [{ key: "sthSopr", name: "STH-SOPR", style: "line" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const series = ctx.aux?.sthSopr;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (series) for (let i = 0; i < n; i++) out[i] = series[i];
    return { series: { sthSopr: out } };
  },
};
