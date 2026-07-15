/**
 * @axiom/indicators — derivatives/asopr.ts
 *
 * aSOPR (Adjusted SOPR) — SOPR excluant les sorties de moins d'1 h (bruit intra-journalier),
 * donc un signal plus propre de réalisation profit/perte. Pivot 1 : > 1 profit moyen réalisé
 * (souvent support en bull), < 1 perte (résistance en bear ; rejets = capitulation).
 *
 * Série aux `asopr` (bitcoin-data.com, journalier, BTC, gratuit). Recopie directe (moteur pur).
 */
import type { IndicatorDef } from "@axiom/types";

export const asopr: IndicatorDef = {
  id: "asopr",
  name: "aSOPR (SOPR ajusté)",
  category: "derivatives",
  pane: "separate",
  aux: ["asopr"],
  minTimeframe: "1d",
  precision: 4,
  inputs: [],
  outputs: [{ key: "asopr", name: "aSOPR", style: "line" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const series = ctx.aux?.asopr;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (series) for (let i = 0; i < n; i++) out[i] = series[i];
    return { series: { asopr: out } };
  },
};
