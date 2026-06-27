/**
 * @axiom/indicators — trend/trix.ts
 *
 * TRIX — taux de variation (ROC 1 période) d'une triple EMA lissée des clôtures,
 * exprimé en pourcentage. Oscillateur de tendance/momentum, pane séparé.
 *
 * Source / formule canonique (Jack Hutson, 1980 ; cf. Investopedia / StockCharts) :
 *   e1[i]   = EMA(close, length)
 *   e2[i]   = EMA(e1,    length)
 *   e3[i]   = EMA(e2,    length)
 *   TRIX[i] = (e3[i] - e3[i-1]) / e3[i-1] * 100
 *
 * Chaînage des EMA : chaque EMA est appliquée aux SEULES valeurs définies de la
 * série précédente puis ré-alignée (les `undefined` du début sont reportés), comme
 * pour la ligne signal du MACD. Valeurs avant fenêtre pleine = `undefined`.
 */

import type {
  Candle,
  CalcContext,
  IndicatorDef,
  IndicatorResult,
} from "@axiom/types";
import { closeOf, ema as emaOf } from "../utils";

/**
 * Applique une fonction de lissage aux seules valeurs définies d'une série, puis
 * ré-aligne le résultat sur les index d'origine (les `undefined` restent `undefined`).
 */
function applyMaybe(
  values: Array<number | undefined>,
  fn: (xs: number[]) => Array<number | undefined>
): Array<number | undefined> {
  const idx: number[] = [];
  const vals: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v !== undefined) {
      idx.push(i);
      vals.push(v);
    }
  }
  const compact = fn(vals);
  const out: Array<number | undefined> = new Array(values.length).fill(undefined);
  for (let j = 0; j < idx.length; j++) {
    const oi = idx[j];
    if (oi === undefined) continue; // garde explicite (noUncheckedIndexedAccess)
    out[oi] = compact[j];
  }
  return out;
}

export const trix: IndicatorDef = {
  id: "trix",
  name: "TRIX",
  category: "trend",
  pane: "separate",
  inputs: [{ key: "length", name: "Longueur", type: "number", default: 18, min: 1 }],
  outputs: [{ key: "trix", name: "TRIX", style: "line" }],

  calc(
    candles: Candle[],
    params: Record<string, number | boolean | string>,
    _ctx: CalcContext
  ): IndicatorResult {
    const length = Number(params.length ?? 18);
    const close = closeOf(candles);
    const n = close.length;

    // Triple lissage exponentiel enchaîné.
    const e1 = emaOf(close, length);
    const e2 = applyMaybe(e1, (xs) => emaOf(xs, length));
    const e3 = applyMaybe(e2, (xs) => emaOf(xs, length));

    // ROC 1 période en %, là où e3[i] et e3[i-1] existent (et e3[i-1] != 0).
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 1; i < n; i++) {
      const cur = e3[i];
      const prev = e3[i - 1];
      if (cur !== undefined && prev !== undefined && prev !== 0) {
        out[i] = ((cur - prev) / prev) * 100;
      }
    }

    return { series: { trix: out } };
  },
};
