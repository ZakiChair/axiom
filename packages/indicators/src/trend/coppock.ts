/**
 * @axiom/indicators — trend/coppock.ts
 *
 * Courbe de Coppock (Edwin Coppock, 1962) — indicateur de momentum long terme,
 * conçu à l'origine sur le mensuel pour repérer les creux de marché. Pane séparé.
 *
 * Source / formule canonique (cf. StockCharts « Coppock Curve ») :
 *   Coppock = WMA( ROC(close, longRoC) + ROC(close, shortRoC), wmaLength )
 * Défauts : longRoC = 14, shortRoC = 11, wmaLength = 10.
 *   ROC(close, n)[i] = (close[i] / close[i-n] - 1) * 100.
 *
 * Valeurs avant fenêtre pleine = `undefined`.
 */

import type {
  Candle,
  CalcContext,
  IndicatorDef,
  IndicatorResult,
} from "@axiom/types";
import { closeOf, wma } from "../utils";

/** ROC en % : (values[i] / values[i-length] - 1) * 100, sinon `undefined`. */
function roc(values: number[], length: number): Array<number | undefined> {
  length = Math.round(length); // fenêtre entière obligatoire (voir sma / kama / fisher)
  const n = values.length;
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  for (let i = length; i < n; i++) {
    const cur = values[i];
    const prev = values[i - length];
    if (cur !== undefined && prev !== undefined && prev !== 0) {
      out[i] = (cur / prev - 1) * 100;
    }
  }
  return out;
}

/** Applique une fonction de lissage aux seules valeurs définies, puis ré-aligne. */
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

export const coppock: IndicatorDef = {
  id: "coppock",
  name: "Coppock",
  category: "trend",
  pane: "separate",
  inputs: [
    { key: "longRoC", name: "ROC long", type: "number", default: 14, min: 1 },
    { key: "shortRoC", name: "ROC court", type: "number", default: 11, min: 1 },
    { key: "wmaLength", name: "WMA", type: "number", default: 10, min: 1 },
  ],
  outputs: [{ key: "coppock", name: "Coppock", style: "line" }],

  calc(
    candles: Candle[],
    params: Record<string, number | boolean | string>,
    _ctx: CalcContext
  ): IndicatorResult {
    const longRoC = Number(params.longRoC ?? 14);
    const shortRoC = Number(params.shortRoC ?? 11);
    const wmaLength = Number(params.wmaLength ?? 10);

    const close = closeOf(candles);
    const n = close.length;

    const rocLong = roc(close, longRoC);
    const rocShort = roc(close, shortRoC);

    // Somme des deux ROC, définie là où les deux existent.
    const sum: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const a = rocLong[i];
      const b = rocShort[i];
      if (a !== undefined && b !== undefined) sum[i] = a + b;
    }

    // WMA des valeurs définies de la somme, ré-alignée.
    const out = applyMaybe(sum, (xs) => wma(xs, wmaLength));

    return { series: { coppock: out } };
  },
};
