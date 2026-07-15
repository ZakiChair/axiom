/**
 * @axiom/indicators — derivatives/lsAccountRatio.ts
 *
 * Long/Short Account Ratio (Binance futures) — ratio du NOMBRE de comptes longs vs
 * shorts : proxy du positionnement de la « foule » (retail). > 1 plus de comptes longs.
 * Souvent contrarien aux extrêmes (foule majoritairement longue près des sommets).
 *
 * Série aux `lsAccount` (Binance /futures/data, perp USDT-M, gratuit). Recopie directe :
 * moteur pur, lecture défensive de ctx.aux.
 */

import type { IndicatorDef } from "@axiom/types";

export const lsAccountRatio: IndicatorDef = {
  id: "lsAccountRatio",
  name: "Long/Short comptes (foule)",
  category: "derivatives",
  pane: "separate",
  aux: ["lsAccount"],
  minTimeframe: "1h",
  precision: 3,
  inputs: [],
  outputs: [{ key: "lsAccountRatio", name: "L/S comptes", style: "line" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const series = ctx.aux?.lsAccount;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (series) {
      for (let i = 0; i < n; i++) out[i] = series[i];
    }
    return { series: { lsAccountRatio: out } };
  },
};
