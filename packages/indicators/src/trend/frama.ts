/**
 * @axiom/indicators — trend/frama.ts
 *
 * FRAMA (Fractal Adaptive Moving Average) — moyenne mobile dont le facteur de
 * lissage s'adapte à la dimension fractale du prix. Overlay sur les bougies.
 *
 * Formule canonique (Ehlers, période N paire) :
 *   half = N / 2
 *   N1 = (max(high)−min(low)) / half  sur la moitié ANCIENNE de la fenêtre
 *   N2 = (max(high)−min(low)) / half  sur la moitié RÉCENTE de la fenêtre
 *   N3 = (max(high)−min(low)) / N     sur la fenêtre complète
 *   D  = ( ln(N1 + N2) − ln(N3) ) / ln(2)        (dimension fractale)
 *   alpha = exp( −4.6 · (D − 1) ),  borné à [0.01, 1]
 *   FRAMA[i] = alpha·close[i] + (1 − alpha)·FRAMA[i−1]
 * Source : John Ehlers (2005), "FRAMA – Fractal Adaptive Moving Average".
 *
 * Amorce : FRAMA[N−1] = close[N−1] ; les positions < N−1 valent `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf, highOf, lowOf } from "../utils";

/** Étendue (max high − min low) sur l'intervalle d'indices [from, to] inclus. */
function rangeOver(
  high: number[],
  low: number[],
  from: number,
  to: number
): number {
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = from; i <= to; i++) {
    const h = high[i];
    const l = low[i];
    if (h !== undefined && h > hi) hi = h;
    if (l !== undefined && l < lo) lo = l;
  }
  return hi - lo;
}

export const frama: IndicatorDef = {
  id: "frama",
  name: "FRAMA",
  category: "trend",
  pane: "overlay",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 16, min: 2 },
  ],
  outputs: [{ key: "frama", name: "FRAMA", style: "line" }],
  calc(candles, params) {
    // N doit être pair (contrainte d'Ehlers) ; on arrondit au pair le plus proche.
    let length = Math.round(Number(params.length ?? 16));
    if (length % 2 !== 0) length += 1;
    if (length < 2) length = 2;

    const close = closeOf(candles);
    const high = highOf(candles);
    const low = lowOf(candles);
    const n = close.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (n < length) return { series: { frama: out } };

    const half = length / 2;
    const ln2 = Math.log(2);

    // Amorce : FRAMA initiale = clôture à la première fenêtre pleine.
    let prev = close[length - 1] ?? 0;
    out[length - 1] = prev;

    for (let i = length; i < n; i++) {
      const c = close[i];
      if (c === undefined) {
        out[i] = prev;
        continue;
      }

      // Moitié ancienne [i−N+1 .. i−half], moitié récente [i−half+1 .. i], plein.
      const n1 = rangeOver(high, low, i - length + 1, i - half) / half;
      const n2 = rangeOver(high, low, i - half + 1, i) / half;
      const n3 = rangeOver(high, low, i - length + 1, i) / length;

      let alpha: number;
      if (n1 > 0 && n2 > 0 && n3 > 0) {
        const d = (Math.log(n1 + n2) - Math.log(n3)) / ln2;
        alpha = Math.exp(-4.6 * (d - 1));
        // Bornage standard d'Ehlers.
        if (alpha < 0.01) alpha = 0.01;
        if (alpha > 1) alpha = 1;
      } else {
        // Étendue dégénérée : on retombe sur un lissage neutre.
        alpha = 0.5;
      }

      prev = alpha * c + (1 - alpha) * prev;
      out[i] = prev;
    }

    return { series: { frama: out } };
  },
};
