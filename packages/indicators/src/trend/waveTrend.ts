/**
 * @axiom/indicators — trend/waveTrend.ts
 *
 * WaveTrend Oscillator (LazyBear) — oscillateur de type « stochastique lissé » sur
 * le prix typique, populaire pour repérer surachat/survente et croisements.
 * Deux lignes (wt1 / wt2). Pane séparé.
 *
 * Source / formule canonique (LazyBear, « WaveTrend Oscillator [WT] », TradingView) :
 *   ap   = hlc3 = (high + low + close) / 3
 *   esa  = EMA(ap, n1)
 *   d    = EMA(|ap - esa|, n1)
 *   ci   = (ap - esa) / (0.015 * d)
 *   tci  = EMA(ci, n2)
 *   wt1  = tci
 *   wt2  = SMA(wt1, 4)
 * Défauts : n1 = 10 (canal), n2 = 21 (moyenne).
 *
 * Valeurs avant fenêtre pleine = `undefined`.
 */

import type {
  Candle,
  CalcContext,
  IndicatorDef,
  IndicatorResult,
} from "@axiom/types";
import { ema as emaOf, sma } from "../utils";

/** Compacte les valeurs définies, applique `fn`, puis ré-aligne sur les index d'origine. */
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

export const waveTrend: IndicatorDef = {
  id: "waveTrend",
  name: "WaveTrend",
  category: "trend",
  pane: "separate",
  inputs: [
    { key: "n1", name: "Canal (n1)", type: "number", default: 10, min: 1 },
    { key: "n2", name: "Moyenne (n2)", type: "number", default: 21, min: 1 },
  ],
  outputs: [
    { key: "wt1", name: "WT1", style: "line" },
    { key: "wt2", name: "WT2", style: "line" },
  ],

  calc(
    candles: Candle[],
    params: Record<string, number | boolean | string>,
    _ctx: CalcContext
  ): IndicatorResult {
    const n1 = Number(params.n1 ?? 10);
    const n2 = Number(params.n2 ?? 21);
    const n = candles.length;

    // Prix typique hlc3 (toujours défini sur chaque bougie).
    const ap: number[] = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      if (c === undefined) continue;
      ap[i] = (c.high + c.low + c.close) / 3;
    }

    const esa = emaOf(ap, n1);

    // d = EMA(|ap - esa|, n1) ; l'écart absolu n'existe que là où esa existe.
    const absDiff: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const e = esa[i];
      const a = ap[i];
      if (e !== undefined && a !== undefined) absDiff[i] = Math.abs(a - e);
    }
    const d = applyMaybe(absDiff, (xs) => emaOf(xs, n1));

    // ci = (ap - esa) / (0.015 * d), là où esa et d existent (et d != 0).
    const ci: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const e = esa[i];
      const a = ap[i];
      const dd = d[i];
      if (e !== undefined && a !== undefined && dd !== undefined && dd !== 0) {
        ci[i] = (a - e) / (0.015 * dd);
      }
    }

    // wt1 = EMA(ci, n2) ; wt2 = SMA(wt1, 4).
    const wt1 = applyMaybe(ci, (xs) => emaOf(xs, n2));
    const wt2 = applyMaybe(wt1, (xs) => sma(xs, 4));

    return { series: { wt1, wt2 } };
  },
};
