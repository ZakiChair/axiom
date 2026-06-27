/**
 * @axiom/indicators — support_resistance/pivotDemark.ts
 *
 * Pivot Points DeMark.
 * Source canonique : TradingView "Pivot Points Standard", méthode DeMark.
 *
 * On choisit X selon la position de la clôture vs l'ouverture de la bougie :
 *   si C < O :  X = H + 2·L + C
 *   si C > O :  X = 2·H + L + C
 *   si C = O :  X = H + L + 2·C
 * Puis :
 *   PP = X / 4
 *   R1 = X/2 − L
 *   S1 = X/2 − H
 *
 * DeMark ne définit qu'un seul couple support/résistance (R1/S1) autour du pivot.
 *
 * SIMPLIFICATION ASSUMÉE (MVP) : O/H/L/C de la BOUGIE PRÉCÉDENTE (candles[i-1]),
 * pas de la session précédente. Bougie 0 -> `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";

export const pivotDemark: IndicatorDef = {
  id: "pivotDemark",
  name: "Pivot Points DeMark",
  category: "support_resistance",
  pane: "overlay",
  inputs: [],
  outputs: [
    { key: "pp", name: "PP", style: "line" },
    { key: "r1", name: "R1", style: "line" },
    { key: "s1", name: "S1", style: "line" },
  ],

  calc(candles) {
    const n = candles.length;
    const pp: Array<number | undefined> = new Array(n).fill(undefined);
    const r1: Array<number | undefined> = new Array(n).fill(undefined);
    const s1: Array<number | undefined> = new Array(n).fill(undefined);

    for (let i = 1; i < n; i++) {
      const prev = candles[i - 1];
      if (prev === undefined) continue; // garde explicite
      const o = prev.open;
      const h = prev.high;
      const l = prev.low;
      const c = prev.close;

      let x: number;
      if (c < o) x = h + 2 * l + c;
      else if (c > o) x = 2 * h + l + c;
      else x = h + l + 2 * c;

      pp[i] = x / 4;
      r1[i] = x / 2 - l;
      s1[i] = x / 2 - h;
    }

    return { series: { pp, r1, s1 } };
  },
};
