/**
 * @axiom/indicators — derivatives/fundingApr.ts
 *
 * Funding annualisé (APR %) à partir de la série aux `funding` (fraction) :
 *   APR% = rate × (24 / intervalH) × 365 × 100
 * Défaut intervalH = 8 (perp Binance classique). Si rate déjà en %, l'utilisateur
 * ajuste via le paramètre (rare). Gratuit via AuxProvider déjà câblé.
 */

import type { IndicatorDef } from "@axiom/types";

export const fundingApr: IndicatorDef = {
  id: "fundingApr",
  name: "Funding APR %",
  category: "derivatives",
  pane: "separate",
  aux: ["funding"],
  minTimeframe: "1h",
  precision: 2,
  inputs: [
    {
      key: "intervalH",
      name: "Règlement funding (h) — 8 ou 4",
      type: "number",
      default: 8,
      min: 1,
      max: 24,
    },
  ],
  outputs: [{ key: "apr", name: "APR %", style: "histogram" }],
  calc(candles, params, ctx) {
    const intervalH = Math.max(1, Number(params.intervalH) || 8);
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    const series = ctx.aux?.funding;
    if (!series) return { series: { apr: out } };
    const mult = (24 / intervalH) * 365 * 100;
    for (let i = 0; i < n; i++) {
      const r = series[i];
      if (r === undefined || !Number.isFinite(r)) continue;
      out[i] = r * mult;
    }
    return { series: { apr: out } };
  },
};
