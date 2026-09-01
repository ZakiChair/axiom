/**
 * @axiom/indicators — trend/kama.ts
 *
 * KAMA (Kaufman's Adaptive Moving Average) — moyenne mobile dont la vitesse
 * s'adapte à l'efficience du marché (rapide en tendance, lente en range).
 * Indicateur de tendance affiché en overlay.
 *
 * Formule canonique (n = période d'efficience, fast = 2, slow = 30) :
 *   ER = |close[i] − close[i−n]| / Σ|close[k] − close[k−1]|  (sur n périodes)
 *   sc = ( ER · (2/(fast+1) − 2/(slow+1)) + 2/(slow+1) )²
 *   KAMA[i] = KAMA[i−1] + sc · (close[i] − KAMA[i−1])
 * Source : Perry Kaufman, "Trading Systems and Methods".
 *
 * Amorce : KAMA[n−1] = close[n−1] ; les positions < n valent `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf, rollingSum } from "../utils";

export const kama: IndicatorDef = {
  id: "kama",
  name: "KAMA",
  category: "trend",
  pane: "overlay",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 10, min: 1 },
    { key: "fast", name: "Rapide", type: "number", default: 2, min: 1 },
    { key: "slow", name: "Lente", type: "number", default: 30, min: 1 },
  ],
  outputs: [{ key: "kama", name: "KAMA", style: "line" }],
  calc(candles, params) {
    // Quantifie : close[i - length] avec length fractionnaire = série vide.
    const length = Math.round(Number(params.length ?? 10));
    const fast = Number(params.fast ?? 2);
    const slow = Number(params.slow ?? 30);

    const close = closeOf(candles);
    const n = close.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (n <= length) return { series: { kama: out } };

    const fastSc = 2 / (fast + 1);
    const slowSc = 2 / (slow + 1);

    // Volatilité = Σ|Δclose| sur `length` périodes (somme des variations absolues).
    const absDiff: number[] = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
      const c = close[i];
      const p = close[i - 1];
      if (c !== undefined && p !== undefined) absDiff[i] = Math.abs(c - p);
    }
    const volatility = rollingSum(absDiff, length);

    // Amorce : on initialise KAMA à la clôture précédant la première fenêtre pleine.
    const seed = close[length - 1];
    let prev = seed ?? 0;
    out[length - 1] = prev;

    for (let i = length; i < n; i++) {
      const c = close[i];
      const cPrev = close[i - length];
      const vol = volatility[i];
      if (c === undefined || cPrev === undefined || vol === undefined) continue;

      // Efficiency Ratio : direction nette / volatilité totale.
      const er = vol === 0 ? 0 : Math.abs(c - cPrev) / vol;
      const sc = (er * (fastSc - slowSc) + slowSc) ** 2;
      prev = prev + sc * (c - prev);
      out[i] = prev;
    }

    return { series: { kama: out } };
  },
};
