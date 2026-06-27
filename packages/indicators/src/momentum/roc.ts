/**
 * @axiom/indicators — momentum/roc.ts
 *
 * ROC (Rate of Change) — variation en pourcentage sur `length` périodes.
 * Source : Investopedia / pandas-ta `roc`.
 *
 * Formule :
 *   ROC[i] = 100 * (close[i] - close[i - length]) / close[i - length]
 *
 * Alignement : les `length` premières positions valent `undefined`
 * (pas de clôture de référence `length` bougies plus tôt).
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf } from "../utils";

export const roc: IndicatorDef = {
  id: "roc",
  name: "ROC",
  category: "momentum",
  pane: "separate",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 9, min: 1 },
  ],
  outputs: [{ key: "roc", name: "ROC", style: "line" }],

  calc(candles, params) {
    const length = Number(params.length ?? 9);
    const close = closeOf(candles);
    const n = close.length;

    const out: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = length; i < n; i++) {
      const cur = close[i];
      const ref = close[i - length];
      if (cur === undefined || ref === undefined || ref === 0) continue;
      out[i] = (100 * (cur - ref)) / ref;
    }

    return { series: { roc: out } };
  },
};
