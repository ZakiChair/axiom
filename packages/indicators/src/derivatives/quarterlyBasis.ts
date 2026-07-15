/**
 * @axiom/indicators — derivatives/quarterlyBasis.ts
 *
 * Basis annualisé du future TRIMESTRIEL courant (structure par terme) :
 *   basis% p.a. = (future − spot) / spot ramené à l'année par le temps jusqu'à échéance.
 * > 0 CONTANGO (future au-dessus du spot : marché haussier / coût de portage positif) ;
 * < 0 BACKWARDATION (future sous le spot : stress, demande de couverture immédiate).
 * Complète le basis spot-perp (`basisPct`, perpétuel) par la dimension DATÉE.
 *
 * Série aux `quarterlyBasis` (Binance COIN-M, front quarter BTC/ETH, klines 1h). Recopie
 * directe : moteur pur. Undefined avant la cotation du contrat courant et hors BTC/ETH.
 */

import type { IndicatorDef } from "@axiom/types";

export const quarterlyBasis: IndicatorDef = {
  id: "quarterlyBasis",
  name: "Basis annualisé (trimestriel)",
  category: "derivatives",
  pane: "separate",
  aux: ["quarterlyBasis"],
  minTimeframe: "1h",
  precision: 2,
  inputs: [],
  outputs: [{ key: "quarterlyBasis", name: "Basis % p.a.", style: "histogram" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const series = ctx.aux?.quarterlyBasis;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (series) {
      for (let i = 0; i < n; i++) out[i] = series[i];
    }
    return { series: { quarterlyBasis: out } };
  },
};
