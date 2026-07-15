/**
 * @axiom/indicators — derivatives/lthSopr.ts
 *
 * LTH-SOPR (Long-Term Holder SOPR) — SOPR des pièces de plus de 155 j : profit/perte des
 * mains « fortes ». Des pics élevés (LTH réalisant de gros profits) accompagnent souvent
 * les sommets de cycle ; sous 1 (LTH vendant à perte) = capitulation profonde / creux.
 * Sa DIVERGENCE avec STH-SOPR distingue distribution des anciens vs panique des récents.
 *
 * Série aux `lthSopr` (bitcoin-data.com, journalier, BTC, gratuit). Recopie directe.
 */
import type { IndicatorDef } from "@axiom/types";

export const lthSopr: IndicatorDef = {
  id: "lthSopr",
  name: "LTH-SOPR (long terme)",
  category: "derivatives",
  pane: "separate",
  aux: ["lthSopr"],
  minTimeframe: "1d",
  precision: 4,
  inputs: [],
  outputs: [{ key: "lthSopr", name: "LTH-SOPR", style: "line" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const series = ctx.aux?.lthSopr;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (series) for (let i = 0; i < n; i++) out[i] = series[i];
    return { series: { lthSopr: out } };
  },
};
