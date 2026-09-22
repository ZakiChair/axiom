/**
 * @axiom/indicators — derivatives/fundingSpreadHl.ts
 *
 * Écart de funding HL − Binance (points de % annualisés) — l'écart de coût de
 * portage entre les deux venues du même sous-jacent : un spread durablement positif
 * signale des longs plus chers sur Hyperliquid (positionnement spéculatif relatif).
 *
 * Conventions hétérogènes ramenées à l'ANNUALISÉ :
 *   HL      : taux HORAIRE  → × 24 × 365 × 100
 *   Binance : taux par règlement 8 h (convention de `fundingApr`, intervalH = 8)
 *             → × 3 × 365 × 100
 *   spread  = (hl × 24 − binance × 3) × 365 × 100
 * `undefined` si l'une des deux jambes manque (jamais de spread sur une jambe seule).
 */
import type { IndicatorDef } from "@axiom/types";

export const fundingSpreadHl: IndicatorDef = {
  id: "fundingSpreadHl",
  name: "Écart de funding HL − Binance (pts % annualisés)",
  category: "derivatives",
  pane: "separate",
  aux: ["hlFunding", "funding"],
  precision: 2,
  inputs: [],
  outputs: [{ key: "spread", name: "Spread APR (pts %)", style: "line" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    const hl = ctx.aux?.hlFunding;
    const bn = ctx.aux?.funding;
    if (hl && bn) {
      for (let i = 0; i < n; i++) {
        const h = hl[i];
        const b = bn[i];
        if (h === undefined || b === undefined) continue;
        if (!Number.isFinite(h) || !Number.isFinite(b)) continue;
        out[i] = (h * 24 - b * 3) * 365 * 100;
      }
    }
    return { series: { spread: out } };
  },
};
