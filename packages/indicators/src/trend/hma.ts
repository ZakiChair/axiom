/**
 * @axiom/indicators — trend/hma.ts
 *
 * HMA (Hull Moving Average) — moyenne mobile de Alan Hull, très réactive et
 * fortement lissée. Indicateur de tendance affiché en overlay.
 *
 * Formule canonique :
 *   raw = 2 × WMA(close, n/2) − WMA(close, n)
 *   HMA = WMA(raw, round(√n))
 * Source : Alan Hull (2005), "How to reduce lag in a moving average".
 *
 * Les positions précédant la première fenêtre pleine valent `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf, wma as wmaOf } from "../utils";

/**
 * Applique une WMA à une série pouvant contenir des `undefined` en tête :
 * on compacte les valeurs définies, on lisse, puis on ré-aligne (les `undefined`
 * initiaux restent `undefined`).
 */
function wmaSeq(
  values: Array<number | undefined>,
  length: number
): Array<number | undefined> {
  const n = values.length;
  const idx: number[] = [];
  const vals: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v !== undefined) {
      idx.push(i);
      vals.push(v);
    }
  }
  const compact = wmaOf(vals, length);
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  for (let j = 0; j < idx.length; j++) {
    const at = idx[j];
    if (at === undefined) continue;
    out[at] = compact[j];
  }
  return out;
}

export const hma: IndicatorDef = {
  id: "hma",
  name: "HMA",
  category: "trend",
  pane: "overlay",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 16, min: 2 },
  ],
  outputs: [{ key: "hma", name: "HMA", style: "line" }],
  calc(candles, params) {
    const length = Number(params.length ?? 16);
    const close = closeOf(candles);
    const n = close.length;

    const half = Math.round(length / 2);
    const sqrtLen = Math.round(Math.sqrt(length));

    const wmaHalf = wmaOf(close, half);
    const wmaFull = wmaOf(close, length);

    // Série brute = 2·WMA(n/2) − WMA(n) ; définie là où les deux WMA existent.
    const raw: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const h = wmaHalf[i];
      const f = wmaFull[i];
      if (h !== undefined && f !== undefined) raw[i] = 2 * h - f;
    }

    return {
      series: {
        hma: wmaSeq(raw, sqrtLen),
      },
    };
  },
};
