/**
 * @axiom/indicators — derivatives/takerBuySellRatio.ts
 *
 * Taker Buy/Sell Ratio (Binance futures) — volume taker ACHETEUR / VENDEUR par période :
 * mesure l'agressivité directionnelle du flux (marché au marché). > 1 les acheteurs
 * frappent l'offre plus fort ; < 1 domination vendeuse agressive.
 *
 * Série aux `lsTaker` (Binance /futures/data, perp USDT-M, gratuit). Distinct du CVD
 * (qui cumule le delta tick) : ici c'est un RATIO agrégé par période. Recopie directe.
 */

import type { IndicatorDef } from "@axiom/types";

export const takerBuySellRatio: IndicatorDef = {
  id: "takerBuySellRatio",
  name: "Taker Buy/Sell (agressif)",
  category: "derivatives",
  pane: "separate",
  aux: ["lsTaker"],
  minTimeframe: "1h",
  precision: 3,
  inputs: [],
  outputs: [{ key: "takerBuySellRatio", name: "Taker B/S", style: "line" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const series = ctx.aux?.lsTaker;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (series) {
      for (let i = 0; i < n; i++) out[i] = series[i];
    }
    return { series: { takerBuySellRatio: out } };
  },
};
