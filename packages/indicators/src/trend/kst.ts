/**
 * @axiom/indicators — trend/kst.ts
 *
 * KST (Know Sure Thing) de Martin Pring — oscillateur de momentum « lissé »
 * combinant quatre ROC de périodes croissantes, chacun lissé par une SMA, puis
 * sommés avec des poids 1/2/3/4. Pane séparé. Ligne signal = SMA(KST).
 *
 * Source / formule canonique (Martin Pring ; cf. StockCharts « Know Sure Thing ») :
 *   RCMA1 = SMA(ROC(close, r1), s1)   poids 1
 *   RCMA2 = SMA(ROC(close, r2), s2)   poids 2
 *   RCMA3 = SMA(ROC(close, r3), s3)   poids 3
 *   RCMA4 = SMA(ROC(close, r4), s4)   poids 4
 *   KST    = RCMA1*1 + RCMA2*2 + RCMA3*3 + RCMA4*4
 *   Signal = SMA(KST, sig)
 * Défauts : r = 10/15/20/30, s = 10/10/10/15, sig = 9.
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
import { closeOf, sma } from "../utils";

/** ROC en % : (values[i] / values[i-length] - 1) * 100, sinon `undefined`. */
function roc(values: number[], length: number): Array<number | undefined> {
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

export const kst: IndicatorDef = {
  id: "kst",
  name: "KST",
  category: "trend",
  pane: "separate",
  inputs: [
    { key: "r1", name: "ROC 1", type: "number", default: 10, min: 1 },
    { key: "r2", name: "ROC 2", type: "number", default: 15, min: 1 },
    { key: "r3", name: "ROC 3", type: "number", default: 20, min: 1 },
    { key: "r4", name: "ROC 4", type: "number", default: 30, min: 1 },
    { key: "s1", name: "SMA 1", type: "number", default: 10, min: 1 },
    { key: "s2", name: "SMA 2", type: "number", default: 10, min: 1 },
    { key: "s3", name: "SMA 3", type: "number", default: 10, min: 1 },
    { key: "s4", name: "SMA 4", type: "number", default: 15, min: 1 },
    { key: "signal", name: "Signal", type: "number", default: 9, min: 1 },
  ],
  outputs: [
    { key: "kst", name: "KST", style: "line" },
    { key: "signal", name: "Signal", style: "line" },
  ],

  calc(
    candles: Candle[],
    params: Record<string, number | boolean | string>,
    _ctx: CalcContext
  ): IndicatorResult {
    const r1 = Number(params.r1 ?? 10);
    const r2 = Number(params.r2 ?? 15);
    const r3 = Number(params.r3 ?? 20);
    const r4 = Number(params.r4 ?? 30);
    const s1 = Number(params.s1 ?? 10);
    const s2 = Number(params.s2 ?? 10);
    const s3 = Number(params.s3 ?? 10);
    const s4 = Number(params.s4 ?? 15);
    const sig = Number(params.signal ?? 9);

    const close = closeOf(candles);
    const n = close.length;

    // Quatre composantes : ROC lissé par SMA (RCMA).
    const rcma1 = applyMaybe(roc(close, r1), (xs) => sma(xs, s1));
    const rcma2 = applyMaybe(roc(close, r2), (xs) => sma(xs, s2));
    const rcma3 = applyMaybe(roc(close, r3), (xs) => sma(xs, s3));
    const rcma4 = applyMaybe(roc(close, r4), (xs) => sma(xs, s4));

    // KST = somme pondérée 1/2/3/4, définie là où les quatre composantes existent.
    const kstLine: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const a = rcma1[i];
      const b = rcma2[i];
      const c = rcma3[i];
      const d = rcma4[i];
      if (a !== undefined && b !== undefined && c !== undefined && d !== undefined) {
        kstLine[i] = a * 1 + b * 2 + c * 3 + d * 4;
      }
    }

    // Signal = SMA des valeurs définies du KST, ré-alignée.
    const signalLine = applyMaybe(kstLine, (xs) => sma(xs, sig));

    return { series: { kst: kstLine, signal: signalLine } };
  },
};
