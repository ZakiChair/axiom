/**
 * @axiom/indicators — derivatives/hlFunding.ts
 *
 * Funding Hyperliquid (APR %) — taux de funding HORAIRE du perp HL annualisé :
 *   APR % = taux × 24 × 365 × 100
 * Série aux `hlFunding` (`fundingHistory` de l'API Hyperliquid — l'API cotise le
 * funding chaque heure, ≠ règlement 8 h de Binance). Alignée sur la clôture.
 */
import type { IndicatorDef } from "@axiom/types";

/** Annualisation d'un taux HORAIRE : × 24 paiements/jour × 365 j × 100 (%). */
const MULT_APR_HORAIRE = 24 * 365 * 100;

export const hlFunding: IndicatorDef = {
  id: "hlFunding",
  name: "Funding Hyperliquid (APR %)",
  category: "derivatives",
  pane: "separate",
  aux: ["hlFunding"],
  precision: 2,
  inputs: [],
  outputs: [{ key: "apr", name: "APR %", style: "line" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    const serie = ctx.aux?.hlFunding;
    if (serie) {
      for (let i = 0; i < n; i++) {
        const v = serie[i];
        if (v !== undefined && Number.isFinite(v)) out[i] = v * MULT_APR_HORAIRE;
      }
    }
    return { series: { apr: out } };
  },
};
