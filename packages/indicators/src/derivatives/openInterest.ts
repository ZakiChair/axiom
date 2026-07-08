/**
 * @axiom/indicators — derivatives/openInterest.ts
 *
 * Open Interest — recopie directe de la série auxiliaire `oi` (fournie par
 * l'appelant, déjà alignée sur les bougies — voir `AuxSeries`, Task 11/12).
 * Le moteur `@axiom/indicators` reste pur : aucun fetch ici, juste une lecture
 * défensive de `ctx.aux`. Si absent (ou clé manquante) : série tout `undefined`,
 * jamais de throw.
 */

import type { IndicatorDef } from "@axiom/types";

export const openInterest: IndicatorDef = {
  id: "openInterest",
  name: "Open Interest",
  category: "derivatives",
  pane: "separate",
  aux: ["oi"],
  minTimeframe: "1h",
  inputs: [],
  outputs: [{ key: "openInterest", name: "Open Interest", style: "line" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const series = ctx.aux?.oi;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (series) {
      for (let i = 0; i < n; i++) out[i] = series[i];
    }
    return { series: { openInterest: out } };
  },
};
