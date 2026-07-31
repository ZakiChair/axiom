/**
 * @axiom/indicators — trend/tema.ts
 *
 * TEMA (Triple Exponential Moving Average) — moyenne mobile à très faible lag.
 * Indicateur de tendance affiché en overlay sur les bougies.
 *
 * Formule canonique :
 *   e1   = EMA(close, n)
 *   e2   = EMA(e1, n)
 *   e3   = EMA(e2, n)
 *   TEMA = 3·e1 − 3·e2 + e3
 * Source : Patrick Mulloy (1994), "Smoothing Data with Faster Moving Averages".
 *
 * Les positions précédant la première fenêtre pleine valent `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf, ema as emaOf } from "../utils";

/**
 * Applique une EMA à une série pouvant contenir des `undefined` en tête :
 * compacte les valeurs définies, lisse, puis ré-aligne.
 */
function emaSeq(
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
  const compact = emaOf(vals, length);
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  for (let j = 0; j < idx.length; j++) {
    const at = idx[j];
    if (at === undefined) continue;
    out[at] = compact[j];
  }
  return out;
}

export const tema: IndicatorDef = {
  id: "tema",
  name: "TEMA",
  category: "trend",
  pane: "overlay",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 20, min: 1 },
  ],
  outputs: [{ key: "tema", name: "TEMA", style: "line" }],
  calc(candles, params) {
    const length = Number(params.length ?? 20);
    const close = closeOf(candles);
    const n = close.length;

    const e1 = emaOf(close, length);
    const e2 = emaSeq(e1, length);
    const e3 = emaSeq(e2, length);

    const out: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const a = e1[i];
      const b = e2[i];
      const c = e3[i];
      if (a !== undefined && b !== undefined && c !== undefined) {
        out[i] = 3 * a - 3 * b + c;
      }
    }

    return { series: { tema: out } };
  },
};
