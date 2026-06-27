/**
 * @axiom/indicators — trend/zlema.ts
 *
 * ZLEMA (Zero-Lag Exponential Moving Average) — EMA dé-laguée par anticipation
 * de la donnée. Indicateur de tendance affiché en overlay.
 *
 * Formule canonique :
 *   lag = floor((n − 1) / 2)
 *   d[i] = 2·close[i] − close[i − lag]   (série "de-lagged")
 *   ZLEMA = EMA(d, n)
 * Source : John Ehlers & Ric Way (2010), "Zero Lag (Well, Almost)".
 *
 * Les positions précédant la première fenêtre pleine valent `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf, ema as emaOf } from "../utils";

/** EMA appliquée à une série avec `undefined` en tête (compacte → lisse → ré-aligne). */
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

export const zlema: IndicatorDef = {
  id: "zlema",
  name: "ZLEMA",
  category: "trend",
  pane: "overlay",
  inputs: [
    { key: "length", name: "Length", type: "number", default: 20, min: 1 },
  ],
  outputs: [{ key: "zlema", name: "ZLEMA", style: "line" }],
  calc(candles, params) {
    const length = Number(params.length ?? 20);
    const close = closeOf(candles);
    const n = close.length;

    const lag = Math.floor((length - 1) / 2);

    // Série dé-laguée : 2·close[i] − close[i−lag], définie à partir de i = lag.
    const deLagged: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = lag; i < n; i++) {
      const c = close[i];
      const cLag = close[i - lag];
      if (c !== undefined && cLag !== undefined) deLagged[i] = 2 * c - cLag;
    }

    return {
      series: {
        zlema: emaSeq(deLagged, length),
      },
    };
  },
};
