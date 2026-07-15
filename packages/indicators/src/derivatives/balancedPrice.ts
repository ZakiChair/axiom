/**
 * @axiom/indicators — derivatives/balancedPrice.ts
 *
 * Balanced Price — realized price moins transferred price : « juste prix » on-chain vers
 * lequel le marché tend à revenir. Le franchissement par le bas marque souvent des creux
 * de cycle (sous-évaluation profonde). Tracé en OVERLAY sur le prix (USD).
 *
 * Série aux `balancedPrice` (bitcoin-data.com, journalier, BTC, gratuit). Recopie directe.
 */
import type { IndicatorDef } from "@axiom/types";

export const balancedPrice: IndicatorDef = {
  id: "balancedPrice",
  name: "Balanced Price (plancher)",
  category: "derivatives",
  pane: "overlay",
  aux: ["balancedPrice"],
  minTimeframe: "1d",
  inputs: [],
  outputs: [{ key: "balancedPrice", name: "Balanced Price", style: "line" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const series = ctx.aux?.balancedPrice;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (series) for (let i = 0; i < n; i++) out[i] = series[i];
    return { series: { balancedPrice: out } };
  },
};
