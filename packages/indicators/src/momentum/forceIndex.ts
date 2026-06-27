/**
 * @axiom/indicators — momentum/forceIndex.ts
 *
 * Force Index — Dr. Alexander Elder (« Trading for a Living », 1993).
 * Combine direction du prix, amplitude du mouvement et volume.
 *
 * Formule canonique (length par défaut = 13) :
 *   rawFI[i] = (close[i] - close[i-1]) * volume[i]
 *   FI       = EMA(rawFI, length)
 *
 * rawFI n'est défini qu'à partir de la bougie 1 (il faut une clôture précédente).
 * L'EMA est appliquée aux seules valeurs définies puis ré-alignée : l'index 0
 * reste `undefined`, et l'amorce de l'EMA (length - 1 valeurs) décale d'autant la
 * première sortie. Première valeur FI à l'index `length`.
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf, ema as emaOf, volOf } from "../utils";

export const forceIndex: IndicatorDef = {
  id: "forceIndex",
  name: "Force Index",
  category: "momentum",
  pane: "separate",
  inputs: [
    { key: "length", name: "Longueur EMA", type: "number", default: 13, min: 1 },
  ],
  outputs: [{ key: "forceIndex", name: "Force Index", style: "line" }],

  calc(candles, params) {
    const length = Number(params.length ?? 13);
    const n = candles.length;
    const closes = closeOf(candles);
    const vols = volOf(candles);

    // rawFI compacté (valeurs définies) + index d'origine pour ré-alignement.
    const rawVals: number[] = [];
    const rawIdx: number[] = [];
    for (let i = 1; i < n; i++) {
      const cur = closes[i];
      const prev = closes[i - 1];
      const v = vols[i];
      if (cur === undefined || prev === undefined || v === undefined) continue;
      rawVals.push((cur - prev) * v);
      rawIdx.push(i);
    }

    const emaRaw = emaOf(rawVals, length);

    const out: Array<number | undefined> = new Array(n).fill(undefined);
    for (let j = 0; j < rawIdx.length; j++) {
      const idx = rawIdx[j];
      if (idx === undefined) continue; // garde (noUncheckedIndexedAccess)
      out[idx] = emaRaw[j];
    }

    return { series: { forceIndex: out } };
  },
};
