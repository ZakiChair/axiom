/**
 * @axiom/indicators — support_resistance/pivotHighLow.ts
 *
 * Pivot High / Low — marqueurs d'extrema locaux.
 * Source canonique : ta.pivothigh / ta.pivotlow (TradingView), version symétrique.
 *
 * Une bougie i est un PIVOT HAUT si son `high` est STRICTEMENT supérieur aux
 * `bars` highs à gauche ET aux `bars` highs à droite. Symétriquement, PIVOT BAS
 * si son `low` est STRICTEMENT inférieur aux `bars` lows de chaque côté.
 * (Strict des deux côtés : un plateau ne produit aucun pivot — pas de doublon.)
 *
 * Fenêtre symétrique de ±`bars` barres (défaut 5). Un pivot ne peut être confirmé
 * qu'une fois les `bars` barres de droite connues : les `bars` premières et les
 * `bars` dernières bougies restent donc `undefined`. La valeur portée à l'index
 * du pivot est le prix de l'extrême (high pour un pivot haut, low pour un bas).
 *
 * Deux séries en style `points` (marqueurs).
 */

import type { IndicatorDef } from "@axiom/types";
import { highOf, lowOf } from "../utils";

export const pivotHighLow: IndicatorDef = {
  id: "pivotHighLow",
  name: "Pivot High/Low",
  category: "support_resistance",
  pane: "overlay",
  inputs: [
    // Nombre de barres de chaque côté (fenêtre symétrique).
    { key: "bars", name: "Barres", type: "number", default: 5, min: 1 },
  ],
  outputs: [
    { key: "pivotHigh", name: "Pivot High", style: "points" },
    { key: "pivotLow", name: "Pivot Low", style: "points" },
  ],

  calc(candles, params) {
    const n = candles.length;
    const pivotHigh: Array<number | undefined> = new Array(n).fill(undefined);
    const pivotLow: Array<number | undefined> = new Array(n).fill(undefined);

    const bars = Math.trunc(Number(params.bars ?? 5));
    if (bars < 1) return { series: { pivotHigh, pivotLow } };

    const highs = highOf(candles);
    const lows = lowOf(candles);

    for (let i = bars; i < n - bars; i++) {
      const h = highs[i];
      const l = lows[i];
      if (h === undefined || l === undefined) continue;

      let isHigh = true;
      let isLow = true;
      for (let j = i - bars; j <= i + bars; j++) {
        if (j === i) continue;
        const hj = highs[j];
        const lj = lows[j];
        if (hj === undefined || lj === undefined) {
          isHigh = false;
          isLow = false;
          break;
        }
        if (hj >= h) isHigh = false; // un voisin >= -> pas un pivot haut strict
        if (lj <= l) isLow = false;
        if (!isHigh && !isLow) break;
      }

      if (isHigh) pivotHigh[i] = h;
      if (isLow) pivotLow[i] = l;
    }

    return { series: { pivotHigh, pivotLow } };
  },
};
