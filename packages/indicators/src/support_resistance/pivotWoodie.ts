/**
 * @axiom/indicators — support_resistance/pivotWoodie.ts
 *
 * Pivot Points Woodie.
 * Source canonique : TradingView "Pivot Points Standard", méthode Woodie.
 *
 *   PP = (H + L + 2·C) / 4          (la clôture est pondérée double)
 *   R1 = 2·PP − L      S1 = 2·PP − H
 *   R2 = PP + (H − L)  S2 = PP − (H − L)
 *
 * SIMPLIFICATION ASSUMÉE (MVP) : H/L/C de la BOUGIE PRÉCÉDENTE (candles[i-1]),
 * pas de la session précédente. Bougie 0 -> `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";

export const pivotWoodie: IndicatorDef = {
  id: "pivotWoodie",
  name: "Pivot Points Woodie",
  category: "support_resistance",
  pane: "overlay",
  inputs: [],
  outputs: [
    { key: "pp", name: "PP", style: "line" },
    { key: "r1", name: "R1", style: "line" },
    { key: "s1", name: "S1", style: "line" },
    { key: "r2", name: "R2", style: "line" },
    { key: "s2", name: "S2", style: "line" },
  ],

  calc(candles) {
    const n = candles.length;
    const pp: Array<number | undefined> = new Array(n).fill(undefined);
    const r1: Array<number | undefined> = new Array(n).fill(undefined);
    const s1: Array<number | undefined> = new Array(n).fill(undefined);
    const r2: Array<number | undefined> = new Array(n).fill(undefined);
    const s2: Array<number | undefined> = new Array(n).fill(undefined);

    for (let i = 1; i < n; i++) {
      const prev = candles[i - 1];
      if (prev === undefined) continue; // garde explicite
      const h = prev.high;
      const l = prev.low;
      const c = prev.close;

      const p = (h + l + 2 * c) / 4;
      pp[i] = p;
      r1[i] = 2 * p - l;
      s1[i] = 2 * p - h;
      r2[i] = p + (h - l);
      s2[i] = p - (h - l);
    }

    return { series: { pp, r1, s1, r2, s2 } };
  },
};
