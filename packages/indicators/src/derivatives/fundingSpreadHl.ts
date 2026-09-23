/**
 * @axiom/indicators — derivatives/fundingSpreadHl.ts
 *
 * Écart de funding HL − Binance (points de % annualisés) — l'écart de coût de
 * portage entre les deux venues du même sous-jacent : un spread durablement positif
 * signale des longs plus chers sur Hyperliquid (positionnement spéculatif relatif).
 *
 * Les deux jambes sont des taux HORAIRES : HL est horaire nativement ; Binance est
 * normalisé depuis les règlements historiques selon leur cadence OBSERVÉE.
 *   spread = (hlHourly − bnHourly) × 24 × 365 × 100
 * `undefined` si l'une des deux jambes manque (jamais de spread sur une jambe seule).
 */
import type { IndicatorDef } from "@axiom/types";

export const fundingSpreadHl: IndicatorDef = {
  id: "fundingSpreadHl",
  name: "Écart funding HL − Binance (cadence observée, pts % annualisés)",
  category: "derivatives",
  pane: "separate",
  aux: ["hlFunding", "binanceFundingHourly"],
  precision: 2,
  inputs: [],
  outputs: [{ key: "spread", name: "Spread APR (pts %)", style: "line" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    const hl = ctx.aux?.hlFunding;
    const bn = ctx.aux?.binanceFundingHourly;
    if (hl && bn) {
      for (let i = 0; i < n; i++) {
        const h = hl[i];
        const b = bn[i];
        if (h === undefined || b === undefined) continue;
        if (!Number.isFinite(h) || !Number.isFinite(b)) continue;
        out[i] = (h - b) * 24 * 365 * 100;
      }
    }
    return { series: { spread: out } };
  },
};
