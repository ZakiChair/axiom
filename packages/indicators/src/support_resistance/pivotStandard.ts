/**
 * @axiom/indicators — support_resistance/pivotStandard.ts
 *
 * Pivot Points Standard (« Floor pivots »).
 * Source canonique : formules de pivots planchers classiques (TradingView
 * "Pivot Points Standard", méthode Traditional).
 *
 *   PP = (H + L + C) / 3
 *   R1 = 2·PP − L            S1 = 2·PP − H
 *   R2 = PP + (H − L)        S2 = PP − (H − L)
 *   R3 = H + 2·(PP − L)      S3 = L − 2·(H − PP)
 *
 * SIMPLIFICATION ASSUMÉE (MVP) : H/L/C proviennent de la BOUGIE PRÉCÉDENTE
 * (candles[i-1]), et NON de la session précédente (jour/semaine). Un vrai
 * découpage par session demanderait un regroupement temporel que le moteur
 * full-array actuel ne fournit pas. Conséquence : les niveaux changent à chaque
 * bougie. La bougie 0 (sans précédente) reste `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";

export const pivotStandard: IndicatorDef = {
  id: "pivotStandard",
  name: "Pivot Points Standard",
  category: "support_resistance",
  pane: "overlay",
  inputs: [],
  outputs: [
    { key: "pp", name: "PP", style: "line" },
    { key: "r1", name: "R1", style: "line" },
    { key: "s1", name: "S1", style: "line" },
    { key: "r2", name: "R2", style: "line" },
    { key: "s2", name: "S2", style: "line" },
    { key: "r3", name: "R3", style: "line" },
    { key: "s3", name: "S3", style: "line" },
  ],

  calc(candles) {
    const n = candles.length;
    const pp: Array<number | undefined> = new Array(n).fill(undefined);
    const r1: Array<number | undefined> = new Array(n).fill(undefined);
    const s1: Array<number | undefined> = new Array(n).fill(undefined);
    const r2: Array<number | undefined> = new Array(n).fill(undefined);
    const s2: Array<number | undefined> = new Array(n).fill(undefined);
    const r3: Array<number | undefined> = new Array(n).fill(undefined);
    const s3: Array<number | undefined> = new Array(n).fill(undefined);

    for (let i = 1; i < n; i++) {
      const prev = candles[i - 1];
      if (prev === undefined) continue; // garde explicite (noUncheckedIndexedAccess)
      const h = prev.high;
      const l = prev.low;
      const c = prev.close;

      const p = (h + l + c) / 3;
      pp[i] = p;
      r1[i] = 2 * p - l;
      s1[i] = 2 * p - h;
      r2[i] = p + (h - l);
      s2[i] = p - (h - l);
      r3[i] = h + 2 * (p - l);
      s3[i] = l - 2 * (h - p);
    }

    return { series: { pp, r1, s1, r2, s2, r3, s3 } };
  },
};
