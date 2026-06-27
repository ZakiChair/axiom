/**
 * @axiom/indicators — trend/schaff.ts
 *
 * Schaff Trend Cycle (STC) de Doug Schaff — applique un double stochastique lissé
 * à la ligne MACD pour produire un oscillateur cyclique borné 0-100, plus réactif
 * que le MACD nu. Pane séparé.
 *
 * Source / formule canonique (Doug Schaff ; impl. de référence LazyBear/TradingView) :
 *   macd  = EMA(close, fast) - EMA(close, slow)
 *   %K1   = 100 * (macd - llv(macd, cycle)) / (hhv(macd, cycle) - llv(macd, cycle))
 *   PF    = PF[-1] + factor * (%K1 - PF[-1])              (lissage, seed = %K1)
 *   %K2   = 100 * (PF - llv(PF, cycle)) / (hhv(PF, cycle) - llv(PF, cycle))
 *   STC   = STC[-1] + factor * (%K2 - STC[-1])            (lissage, seed = %K2)
 * Défauts : fast = 23, slow = 50, cycle = 10, factor = 0.5.
 * Si l'amplitude (hhv - llv) est nulle, on reporte la valeur précédente du
 * stochastique (convention `nz`). Sortie clampée à [0, 100].
 *
 * Valeurs avant fenêtre pleine = `undefined`.
 */

import type {
  Candle,
  CalcContext,
  IndicatorDef,
  IndicatorResult,
} from "@axiom/types";
import { closeOf, ema as emaOf, rollingHighest, rollingLowest } from "../utils";

/** %K stochastique sur une série pleine ; reporte la valeur précédente si amplitude nulle. */
function stochNum(values: number[], length: number): Array<number | undefined> {
  const n = values.length;
  const hi = rollingHighest(values, length);
  const lo = rollingLowest(values, length);
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  let prev: number | undefined;
  for (let i = 0; i < n; i++) {
    const h = hi[i];
    const l = lo[i];
    const v = values[i];
    if (h === undefined || l === undefined || v === undefined) continue;
    const range = h - l;
    const k = range > 0 ? (100 * (v - l)) / range : (prev ?? 0);
    out[i] = k;
    prev = k;
  }
  return out;
}

/** Lissage récursif x[i] = x[i-1] + factor*(v - x[i-1]) ; seed = première valeur définie. */
function smoothMaybe(
  values: Array<number | undefined>,
  factor: number
): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(values.length).fill(undefined);
  let prev: number | undefined;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === undefined) continue;
    prev = prev === undefined ? v : prev + factor * (v - prev);
    out[i] = prev;
  }
  return out;
}

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

export const schaff: IndicatorDef = {
  id: "schaff",
  name: "Schaff Trend Cycle",
  category: "trend",
  pane: "separate",
  inputs: [
    { key: "fast", name: "MACD rapide", type: "number", default: 23, min: 1 },
    { key: "slow", name: "MACD lent", type: "number", default: 50, min: 1 },
    { key: "cycle", name: "Cycle", type: "number", default: 10, min: 1 },
    { key: "factor", name: "Facteur", type: "number", default: 0.5, min: 0, max: 1 },
  ],
  outputs: [{ key: "stc", name: "STC", style: "line" }],

  calc(
    candles: Candle[],
    params: Record<string, number | boolean | string>,
    _ctx: CalcContext
  ): IndicatorResult {
    const fast = Number(params.fast ?? 23);
    const slow = Number(params.slow ?? 50);
    const cycle = Number(params.cycle ?? 10);
    const factor = Number(params.factor ?? 0.5);

    const close = closeOf(candles);
    const n = close.length;

    // Ligne MACD : différence des deux EMA, définie là où les deux existent.
    const fastEma = emaOf(close, fast);
    const slowEma = emaOf(close, slow);
    const macdLine: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const f = fastEma[i];
      const s = slowEma[i];
      if (f !== undefined && s !== undefined) macdLine[i] = f - s;
    }

    // Double stochastique lissé, opérant sur les valeurs définies du MACD.
    const out = applyMaybe(macdLine, (m) => {
      const k1 = stochNum(m, cycle);
      const pf = smoothMaybe(k1, factor);
      const k2 = applyMaybe(pf, (xs) => stochNum(xs, cycle));
      const stc = smoothMaybe(k2, factor);
      // Clamp défensif à [0, 100].
      return stc.map((v) =>
        v === undefined ? undefined : Math.max(0, Math.min(100, v))
      );
    });

    return { series: { stc: out } };
  },
};
