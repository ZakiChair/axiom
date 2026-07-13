/**
 * @axiom/indicators — derivatives/oiChange.ts
 *
 * Variation relative de l'Open Interest (série aux `oi`, déjà en USD alignée) :
 *   Δ% = 100 · (OI[i] − OI[i−lookback]) / OI[i−lookback]
 * Croisé avec le prix (lecture 4 quadrants) pour build-up / squeeze.
 * Latence fournisseur ≤ 1 min assumée (badge dérivés).
 */

import type { IndicatorDef } from "@axiom/types";

export const oiChange: IndicatorDef = {
  id: "oiChange",
  name: "OI Δ%",
  category: "derivatives",
  pane: "separate",
  aux: ["oi"],
  minTimeframe: "1h",
  precision: 2,
  inputs: [
    {
      key: "lookback",
      name: "Lookback (barres)",
      type: "number",
      default: 24,
      min: 1,
      max: 500,
    },
  ],
  outputs: [{ key: "changePct", name: "Δ OI %", style: "histogram" }],
  calc(candles, params, ctx) {
    const lookback = Math.max(1, Math.floor(Number(params.lookback) || 24));
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    const series = ctx.aux?.oi;
    if (!series) return { series: { changePct: out } };
    for (let i = lookback; i < n; i++) {
      const cur = series[i];
      const prev = series[i - lookback];
      if (cur === undefined || prev === undefined || !Number.isFinite(cur) || !Number.isFinite(prev)) {
        continue;
      }
      if (prev === 0) continue;
      out[i] = (100 * (cur - prev)) / prev;
    }
    return { series: { changePct: out } };
  },
};
