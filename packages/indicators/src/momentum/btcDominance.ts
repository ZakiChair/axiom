/**
 * @axiom/indicators — momentum/btcDominance.ts
 *
 * Dominance BTC — part de Bitcoin dans la capitalisation crypto totale (%). Structure de
 * marché GLOBALE : une dominance qui monte = fuite vers BTC (altcoins sous pression) ;
 * qui baisse = appétit pour le risque (« alt season »). Identique quel que soit le
 * symbole affiché (métrique de marché, pas par actif).
 *
 * Série aux `btcDominance` (bitcoin-data.com, journalier, gratuit). Recopie directe.
 */
import type { IndicatorDef } from "@axiom/types";

export const btcDominance: IndicatorDef = {
  id: "btcDominance",
  name: "Dominance BTC (%)",
  category: "momentum",
  pane: "separate",
  aux: ["btcDominance"],
  minTimeframe: "1d",
  precision: 2,
  inputs: [],
  outputs: [{ key: "btcDominance", name: "BTC.D %", style: "line" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const series = ctx.aux?.btcDominance;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (series) for (let i = 0; i < n; i++) out[i] = series[i];
    return { series: { btcDominance: out } };
  },
};
