/**
 * @axiom/indicators — derivatives/cvdd.ts
 *
 * CVDD (Cumulative Value Days Destroyed price) — modèle de PLANCHER de prix dérivé de
 * la destruction cumulée de valeur-jours : historiquement une borne basse quasi jamais
 * franchie (support de fond de cycle). Tracé en OVERLAY sur le prix (USD).
 *
 * Série aux `cvdd` (bitcoin-data.com, journalier, BTC, gratuit). Recopie directe.
 */
import type { IndicatorDef } from "@axiom/types";

export const cvdd: IndicatorDef = {
  id: "cvdd",
  name: "CVDD (plancher)",
  category: "derivatives",
  pane: "overlay",
  aux: ["cvdd"],
  minTimeframe: "1d",
  inputs: [],
  outputs: [{ key: "cvdd", name: "CVDD", style: "line" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const series = ctx.aux?.cvdd;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (series) for (let i = 0; i < n; i++) out[i] = series[i];
    return { series: { cvdd: out } };
  },
};
