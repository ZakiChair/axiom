/**
 * @axiom/indicators — volume/anchored-vwap.ts
 *
 * Anchored VWAP — VWAP cumulée à partir d'un point d'ancrage choisi.
 *
 * Contrairement à la VWAP de session (qui cumule depuis la première bougie),
 * l'Anchored VWAP démarre son cumul à l'index d'ancrage `anchorIndex`. Avant cet
 * index, la valeur n'a pas de sens et reste `undefined`.
 *
 * Le prix typique de chaque bougie est `hlc3 = (high + low + close) / 3`, déjà
 * fourni par le moteur via `ctx.hlc3`.
 *
 * Formule cumulative, de `anchorIndex` jusqu'à i :
 *   cumTPV[i] = Σ (tp[k] * volume[k])   pour k de anchorIndex à i
 *   cumVol[i] = Σ volume[k]             pour k de anchorIndex à i
 *   vwap[i]   = cumTPV[i] / cumVol[i]
 *
 * Garde vol cumulé = 0 : tant qu'aucun volume n'a été cumulé depuis l'ancrage
 * (bougies sans volume), la moyenne pondérée n'est pas définie -> `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";

export const anchoredVwap: IndicatorDef = {
  id: "anchoredVwap",
  name: "Anchored VWAP",
  category: "volume",
  pane: "overlay",
  inputs: [
    {
      key: "anchorIndex",
      name: "Index d'ancrage",
      type: "number",
      default: 0,
      min: 0,
    },
  ],
  outputs: [{ key: "anchoredVwap", name: "Anchored VWAP", style: "line" }],

  calc(candles, params, ctx) {
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);

    // Index d'ancrage borné dans [0, n] (un ancrage hors borne ne produit rien).
    const anchorIndex = Math.max(0, Math.floor(Number(params.anchorIndex)));

    let cumTPV = 0; // Σ (prix typique * volume) depuis l'ancrage
    let cumVol = 0; // Σ volume depuis l'ancrage

    for (let i = anchorIndex; i < n; i++) {
      const c = candles[i];
      const tp = ctx.hlc3[i];
      if (c === undefined || tp === undefined) continue;

      cumTPV += tp * c.volume;
      cumVol += c.volume;

      // Garde vol=0 : sans volume cumulé, la moyenne pondérée n'est pas définie.
      if (cumVol > 0) out[i] = cumTPV / cumVol;
    }

    return { series: { anchoredVwap: out } };
  },
};
