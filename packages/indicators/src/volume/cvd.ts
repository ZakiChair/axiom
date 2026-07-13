/**
 * @axiom/indicators — volume/cvd.ts
 *
 * CVD (Cumulative Volume Delta) par bougie — somme cumulée de
 * (buyVolume − sellVolume). Exige les champs taker buy/sell sur la Candle
 * (Binance spot/perp, etc.). Sans ces champs → 0 pour la barre (dégradation).
 *
 * Edge : divergence prix/CVD (haut de prix sans haut de CVD = absorption).
 * Offset d'ancrage arbitraire → lire pentes/divergences, pas niveaux absolus.
 */

import type { IndicatorDef } from "@axiom/types";

export const cvd: IndicatorDef = {
  id: "cvd",
  name: "CVD (Volume Delta cumulé)",
  category: "volume",
  pane: "separate",
  inputs: [],
  outputs: [{ key: "cvd", name: "CVD", style: "line" }],
  precision: 0,
  calc(candles) {
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      if (c === undefined) {
        out[i] = acc;
        continue;
      }
      const buy = c.buyVolume;
      const sell = c.sellVolume;
      if (buy !== undefined && sell !== undefined && Number.isFinite(buy) && Number.isFinite(sell)) {
        acc += buy - sell;
      }
      out[i] = acc;
    }
    return { series: { cvd: out } };
  },
};
