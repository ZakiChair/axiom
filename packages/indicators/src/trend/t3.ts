/**
 * @axiom/indicators — trend/t3.ts
 *
 * T3 (Tillson Moving Average) — moyenne mobile lissée à très faible lag, basée
 * sur la "Generalized DEMA". Indicateur de tendance affiché en overlay.
 *
 * Formule canonique (volume factor v = 0.7) :
 *   GD(x) = EMA(x)·(1 + v) − EMA(EMA(x))·v
 *   T3    = GD( GD( GD(close) ) )
 * Source : Tim Tillson (1998), "Smoothing Techniques for More Accurate Signals".
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

/** Generalized DEMA : GD(x) = EMA(x)·(1+v) − EMA(EMA(x))·v. */
function gd(
  values: Array<number | undefined>,
  length: number,
  v: number
): Array<number | undefined> {
  const e1 = emaSeq(values, length);
  const e2 = emaSeq(e1, length);
  const n = values.length;
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  for (let i = 0; i < n; i++) {
    const a = e1[i];
    const b = e2[i];
    if (a !== undefined && b !== undefined) out[i] = a * (1 + v) - b * v;
  }
  return out;
}

export const t3: IndicatorDef = {
  id: "t3",
  name: "T3",
  category: "trend",
  pane: "overlay",
  inputs: [
    { key: "length", name: "Length", type: "number", default: 5, min: 1 },
    { key: "v", name: "Volume Factor", type: "number", default: 0.7, min: 0, max: 1 },
  ],
  outputs: [{ key: "t3", name: "T3", style: "line" }],
  calc(candles, params) {
    const length = Number(params.length ?? 5);
    const v = Number(params.v ?? 0.7);
    const close = closeOf(candles);

    // T3 = GD(GD(GD(close))).
    const out = gd(gd(gd(close, length, v), length, v), length, v);

    return { series: { t3: out } };
  },
};
