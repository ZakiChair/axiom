/**
 * @axiom/indicators — derivatives/lsTopTraderRatio.ts
 *
 * Top Trader Long/Short Ratio (Binance futures) — ratio des POSITIONS des plus gros
 * comptes (« smart money ») : > 1 les top traders sont nets longs. Sa DIVERGENCE avec
 * le ratio de la foule (lsAccountRatio) est le vrai signal : foule longue / top traders
 * shorts = configuration de retournement classique.
 *
 * Série aux `lsTopTrader` (Binance /futures/data, perp USDT-M, gratuit). Recopie directe.
 */

import type { IndicatorDef } from "@axiom/types";

export const lsTopTraderRatio: IndicatorDef = {
  id: "lsTopTraderRatio",
  name: "Long/Short top traders",
  category: "derivatives",
  pane: "separate",
  aux: ["lsTopTrader"],
  minTimeframe: "1h",
  precision: 3,
  inputs: [],
  outputs: [{ key: "lsTopTraderRatio", name: "L/S top traders", style: "line" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const series = ctx.aux?.lsTopTrader;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (series) {
      for (let i = 0; i < n; i++) out[i] = series[i];
    }
    return { series: { lsTopTraderRatio: out } };
  },
};
