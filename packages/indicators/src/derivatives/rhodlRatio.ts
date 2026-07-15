/**
 * @axiom/indicators — derivatives/rhodlRatio.ts
 *
 * RHODL Ratio — rapport des bandes RHODL 1-semaine / 1-2 ans (Realized HODL) : détecte
 * les sommets de cycle quand la valeur des pièces récemment déplacées domine celle des
 * pièces anciennes. Valeurs TRÈS élevées = zone de sommet historique ; valeurs basses =
 * creux de marché baissier. Indicateur macro (échelle large).
 *
 * Série aux `rhodl` (bitcoin-data.com, journalier, BTC, gratuit). Recopie directe.
 */
import type { IndicatorDef } from "@axiom/types";

export const rhodlRatio: IndicatorDef = {
  id: "rhodlRatio",
  name: "RHODL Ratio",
  category: "derivatives",
  pane: "separate",
  aux: ["rhodl"],
  minTimeframe: "1d",
  precision: 1,
  inputs: [],
  outputs: [{ key: "rhodlRatio", name: "RHODL Ratio", style: "line" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const series = ctx.aux?.rhodl;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (series) for (let i = 0; i < n; i++) out[i] = series[i];
    return { series: { rhodlRatio: out } };
  },
};
