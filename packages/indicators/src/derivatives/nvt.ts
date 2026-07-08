/**
 * @axiom/indicators — derivatives/nvt.ts
 *
 * NVT (Network Value to Transactions) — recopie directe de la série
 * auxiliaire `nvt` (fournie par l'appelant, déjà alignée sur les bougies —
 * voir `AuxSeries`, Task 11/12). Le moteur `@axiom/indicators` reste pur :
 * aucun fetch ici, juste une lecture défensive de `ctx.aux`. Si absent (ou
 * clé manquante) : série tout `undefined`, jamais de throw.
 */

import type { IndicatorDef } from "@axiom/types";

export const nvt: IndicatorDef = {
  id: "nvt",
  name: "NVT Ratio",
  category: "derivatives",
  pane: "separate",
  aux: ["nvt"],
  minTimeframe: "1d",
  inputs: [],
  outputs: [{ key: "nvt", name: "NVT Ratio", style: "line" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const series = ctx.aux?.nvt;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (series) {
      for (let i = 0; i < n; i++) out[i] = series[i];
    }
    return { series: { nvt: out } };
  },
};
