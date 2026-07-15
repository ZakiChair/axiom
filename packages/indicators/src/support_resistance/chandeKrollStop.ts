/**
 * @axiom/indicators — support_resistance/chandeKrollStop.ts
 *
 * Chande Kroll Stop — deux lignes de stop suiveur basées sur l'ATR :
 *   ATR      = rma(trueRange, p)
 *   preHigh  = plusHaut(high, p) − x·ATR
 *   preLow   = plusBas(low, p)   + x·ATR
 *   stopHigh = plusHaut(preHigh, q)   (ligne du dessus — stop des positions SHORT)
 *   stopLow  = plusBas(preLow,  q)    (ligne du dessous — stop des positions LONG)
 * Le prix franchissant stopLow par le bas (ou stopHigh par le haut) signale la sortie.
 *
 * Défauts : p=10, x=1, q=9. Overlay. Réutilise trueRange + rma (utils).
 */

import type { Candle, CalcContext, IndicatorDef, IndicatorResult } from "@axiom/types";
import { highOf, lowOf, rma, trueRange } from "../utils";

/** Extrême roulant STRICT : undefined tant que les `length` valeurs ne sont pas TOUTES définies. */
function rollingExtremeStrict(
  values: Array<number | undefined>,
  length: number,
  type: "max" | "min",
): Array<number | undefined> {
  const n = values.length;
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  for (let i = length - 1; i < n; i++) {
    let ext = type === "max" ? -Infinity : Infinity;
    let complet = true;
    for (let j = i - length + 1; j <= i; j++) {
      const v = values[j];
      if (v === undefined) {
        complet = false;
        break;
      }
      ext = type === "max" ? Math.max(ext, v) : Math.min(ext, v);
    }
    if (complet) out[i] = ext;
  }
  return out;
}

export const chandeKrollStop: IndicatorDef = {
  id: "chandeKrollStop",
  name: "Chande Kroll Stop",
  category: "support_resistance",
  pane: "overlay",
  inputs: [
    { key: "p", name: "ATR/extrême (p)", type: "number", default: 10, min: 1 },
    { key: "x", name: "Multiplicateur ATR (x)", type: "number", default: 1, min: 0 },
    { key: "q", name: "Lissage stop (q)", type: "number", default: 9, min: 1 },
  ],
  outputs: [
    { key: "stopHigh", name: "Stop haut", style: "line" },
    { key: "stopLow", name: "Stop bas", style: "line" },
  ],
  calc(candles: Candle[], params: Record<string, number | boolean | string>, _ctx: CalcContext): IndicatorResult {
    const p = Number(params.p);
    const x = Number(params.x);
    const q = Number(params.q);
    const n = candles.length;

    const atr = rma(trueRange(candles), p);
    const hh = rollingExtremeStrict(highOf(candles), p, "max");
    const ll = rollingExtremeStrict(lowOf(candles), p, "min");

    const preHigh: Array<number | undefined> = new Array(n).fill(undefined);
    const preLow: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const a = atr[i];
      const h = hh[i];
      const l = ll[i];
      if (a !== undefined && h !== undefined) preHigh[i] = h - x * a;
      if (a !== undefined && l !== undefined) preLow[i] = l + x * a;
    }

    const stopHigh = rollingExtremeStrict(preHigh, q, "max");
    const stopLow = rollingExtremeStrict(preLow, q, "min");
    return { series: { stopHigh, stopLow } };
  },
};
