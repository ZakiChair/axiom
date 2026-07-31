/**
 * @axiom/indicators — billwilliams/fractals.ts
 *
 * Fractals de Bill Williams — marqueurs (points) tracés en overlay.
 * Source : « Trading Chaos » (Bill Williams). Définition canonique sur 5 barres :
 *   - Fractale HAUTE à la barre centrale i si high[i] est STRICTEMENT supérieur
 *     aux deux hauts à sa gauche (i-1, i-2) ET aux deux hauts à sa droite (i+1, i+2).
 *   - Fractale BASSE à la barre i si low[i] est STRICTEMENT inférieur aux deux bas
 *     à gauche ET aux deux bas à droite.
 *
 * La valeur du marqueur est le prix (high pour le haut, low pour le bas) afin de
 * pouvoir le positionner sur le graphique ; ailleurs `undefined`.
 * Une fractale a besoin de 2 barres futures pour être confirmée : les 2 dernières
 * barres ne peuvent donc jamais porter de marqueur, ni les 2 premières.
 */

import type {
  Candle,
  CalcContext,
  IndicatorDef,
  IndicatorResult,
} from "@axiom/types";
import { highOf, lowOf } from "../utils";

export const fractals: IndicatorDef = {
  id: "fractals",
  name: "Fractales",
  category: "billwilliams",
  pane: "overlay",
  inputs: [],
  outputs: [
    { key: "up", name: "Fractale haute", style: "points" },
    { key: "down", name: "Fractale basse", style: "points" },
  ],

  calc(
    candles: Candle[],
    _params: Record<string, number | boolean | string>,
    _ctx: CalcContext
  ): IndicatorResult {
    const highs = highOf(candles);
    const lows = lowOf(candles);
    const n = candles.length;

    const up: Array<number | undefined> = new Array(n).fill(undefined);
    const down: Array<number | undefined> = new Array(n).fill(undefined);

    // La barre centrale i va de 2 à n-3 (besoin de 2 barres de chaque côté).
    for (let i = 2; i < n - 2; i++) {
      const h = highs[i];
      const hL2 = highs[i - 2];
      const hL1 = highs[i - 1];
      const hR1 = highs[i + 1];
      const hR2 = highs[i + 2];
      if (
        h !== undefined &&
        hL2 !== undefined &&
        hL1 !== undefined &&
        hR1 !== undefined &&
        hR2 !== undefined &&
        h > hL1 &&
        h > hL2 &&
        h > hR1 &&
        h > hR2
      ) {
        up[i] = h;
      }

      const l = lows[i];
      const lL2 = lows[i - 2];
      const lL1 = lows[i - 1];
      const lR1 = lows[i + 1];
      const lR2 = lows[i + 2];
      if (
        l !== undefined &&
        lL2 !== undefined &&
        lL1 !== undefined &&
        lR1 !== undefined &&
        lR2 !== undefined &&
        l < lL1 &&
        l < lL2 &&
        l < lR1 &&
        l < lR2
      ) {
        down[i] = l;
      }
    }

    return { series: { up, down } };
  },
};
