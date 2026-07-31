/**
 * @axiom/indicators — derivatives/realizedPrice.ts
 *
 * Realized Price — prix moyen d'ACQUISITION on-chain (realized cap / offre en
 * circulation) : « coût de base » agrégé du réseau. Tracé en OVERLAY sur le prix :
 * quand le spot passe SOUS le realized price, le marché est globalement en perte
 * latente (zones de capitulation / plancher historique) ; au-dessus, en profit.
 *
 * Série aux `realizedPrice` (bitcoin-data.com / BGeometrics, USD, journalier, BTC
 * uniquement, gratuit). Recopie directe : moteur pur, lecture défensive de ctx.aux.
 * Overlay pertinent surtout sur un chart BTC en USD (même échelle de prix).
 */

import type { IndicatorDef } from "@axiom/types";

export const realizedPrice: IndicatorDef = {
  id: "realizedPrice",
  name: "Prix réalisé (on-chain)",
  category: "derivatives",
  pane: "overlay",
  aux: ["realizedPrice"],
  minTimeframe: "1d",
  inputs: [],
  outputs: [{ key: "realizedPrice", name: "Realized Price", style: "line" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const series = ctx.aux?.realizedPrice;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (series) {
      for (let i = 0; i < n; i++) out[i] = series[i];
    }
    return { series: { realizedPrice: out } };
  },
};
