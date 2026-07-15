/**
 * @axiom/indicators — derivatives/ssr.ts
 *
 * SSR (Stablecoin Supply Ratio) — capitalisation de l'actif rapportée à l'offre
 * agrégée de stablecoins : mesure le « pouvoir d'achat » stable disponible relatif
 * à la taille du marché.
 *   ssr[i] = marketCap[i] / stablecoinSupply[i]
 * SSR BAS  = beaucoup de stablecoins vs cap → potentiel d'achat élevé (bullish) ;
 * SSR HAUT = peu de stablecoins relativement → moins de carburant (bearish).
 *
 * `marketcap` = CapMrktCurUSD (Coin Metrics, aux) ; `stablecoins` = offre agrégée
 * (DefiLlama, aux). Les deux sont journaliers → pertinent en 1d. BTC only côté Coin
 * Metrics community : SSR reste `undefined` (dégradation gracieuse) hors BTC.
 * PURE (lecture défensive de ctx.aux, aucun fetch).
 */

import type { IndicatorDef } from "@axiom/types";

export const ssr: IndicatorDef = {
  id: "ssr",
  name: "SSR (Stablecoin Supply Ratio)",
  category: "derivatives",
  pane: "separate",
  aux: ["marketcap", "stablecoins"],
  minTimeframe: "1d",
  precision: 2,
  inputs: [],
  outputs: [{ key: "ssr", name: "SSR", style: "line" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    const mcap = ctx.aux?.marketcap;
    const stables = ctx.aux?.stablecoins;
    if (!mcap || !stables) return { series: { ssr: out } };

    for (let i = 0; i < n; i++) {
      const m = mcap[i];
      const s = stables[i];
      if (m === undefined || s === undefined || !Number.isFinite(m) || !Number.isFinite(s) || s === 0) {
        continue;
      }
      out[i] = m / s;
    }
    return { series: { ssr: out } };
  },
};
