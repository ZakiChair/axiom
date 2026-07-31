/**
 * @axiom/indicators — derivatives/fundingRate.ts
 *
 * Funding Rate — recopie directe de la série auxiliaire `funding` (fournie par
 * l'appelant, déjà alignée sur les bougies — voir `AuxSeries`, Task 11/12).
 * Le moteur `@axiom/indicators` reste pur : aucun fetch ici, juste une lecture
 * défensive de `ctx.aux`. Si absent (ou clé manquante) : série tout `undefined`,
 * jamais de throw.
 */

import type { IndicatorDef } from "@axiom/types";

export const fundingRate: IndicatorDef = {
  id: "fundingRate",
  name: "Taux de funding",
  category: "derivatives",
  pane: "separate",
  aux: ["funding"],
  minTimeframe: "1h",
  inputs: [],
  outputs: [{ key: "fundingRate", name: "Taux de funding", style: "histogram" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const series = ctx.aux?.funding;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (series) {
      for (let i = 0; i < n; i++) out[i] = series[i];
    }
    return { series: { fundingRate: out } };
  },
};
