/**
 * @axiom/indicators — trend/aroon.ts
 *
 * Aroon (Tushar Chande, 1995) — mesure le temps écoulé depuis le dernier extrême.
 * Source canonique : StockCharts / TradingView (formule highestbars/lowestbars).
 * Affiché dans un pane séparé.
 *
 * Calcul (n = 14) sur une fenêtre de n+1 bougies (n périodes + bougie courante) :
 *   AroonUp   = 100 * (n - barsDepuisPlusHaut) / n
 *   AroonDown = 100 * (n - barsDepuisPlusBas)  / n
 *   où barsDepuis* ∈ [0, n] : 0 = extrême sur la bougie courante (-> 100),
 *   n = extrême il y a n bougies (-> 0). En cas d'égalité, l'extrême le plus RÉCENT
 *   est retenu (convention TradingView).
 *
 * Les deux sorties sont bornées dans [0, 100]. Première valeur à l'index n
 * (il faut n+1 bougies). Avant : `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";
import { highOf, lowOf } from "../utils";

export const aroon: IndicatorDef = {
  id: "aroon",
  name: "Aroon",
  category: "trend",
  pane: "separate",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 14, min: 1 },
  ],
  outputs: [
    { key: "up", name: "Aroon Up", style: "line" },
    { key: "down", name: "Aroon Down", style: "line" },
  ],
  calc(candles, params) {
    // Quantifie : boucle `i = length` fractionnaire n'atteint aucun index entier.
    const length = Math.round(Number(params.length ?? 14));
    const highs = highOf(candles);
    const lows = lowOf(candles);
    const n = candles.length;

    const up: Array<number | undefined> = new Array(n).fill(undefined);
    const down: Array<number | undefined> = new Array(n).fill(undefined);

    for (let i = length; i < n; i++) {
      // Fenêtre [i - length, i] (n+1 valeurs).
      let hiIdx = i;
      let loIdx = i;
      let hiVal = highs[i];
      let loVal = lows[i];
      if (hiVal === undefined || loVal === undefined) continue;

      for (let j = i - length; j <= i; j++) {
        const h = highs[j];
        const l = lows[j];
        if (h === undefined || l === undefined) continue;
        // >= et <= : conserve l'occurrence la plus récente en cas d'égalité.
        if (h >= hiVal) {
          hiVal = h;
          hiIdx = j;
        }
        if (l <= loVal) {
          loVal = l;
          loIdx = j;
        }
      }

      const barsSinceHigh = i - hiIdx;
      const barsSinceLow = i - loIdx;
      up[i] = (100 * (length - barsSinceHigh)) / length;
      down[i] = (100 * (length - barsSinceLow)) / length;
    }

    return { series: { up, down } };
  },
};
