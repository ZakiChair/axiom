/**
 * @axiom/indicators — derivatives/stablecoinSupply.ts
 *
 * Stablecoin Supply — recopie directe de la série auxiliaire `stablecoins`
 * (fournie par l'appelant, déjà alignée sur les bougies — voir `AuxSeries`,
 * Task 11/12). Le moteur `@axiom/indicators` reste pur : aucun fetch ici,
 * juste une lecture défensive de `ctx.aux`. Si absent (ou clé manquante) :
 * série tout `undefined`, jamais de throw.
 */

import type { IndicatorDef } from "@axiom/types";

export const stablecoinSupply: IndicatorDef = {
  id: "stablecoinSupply",
  name: "Offre de stablecoins",
  category: "derivatives",
  pane: "separate",
  aux: ["stablecoins"],
  minTimeframe: "1d",
  inputs: [],
  outputs: [{ key: "stablecoinSupply", name: "Offre de stablecoins", style: "line" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const series = ctx.aux?.stablecoins;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (series) {
      for (let i = 0; i < n; i++) out[i] = series[i];
    }
    return { series: { stablecoinSupply: out } };
  },
};
