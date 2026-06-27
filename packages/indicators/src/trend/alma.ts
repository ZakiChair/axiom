/**
 * @axiom/indicators — trend/alma.ts
 *
 * ALMA (Arnaud Legoux Moving Average) — moyenne mobile à pondération gaussienne
 * décalée, qui réduit le lag tout en filtrant le bruit. Overlay sur les bougies.
 *
 * Formule canonique (fenêtre N, offset, sigma) :
 *   m = offset · (N − 1)         (décalage du pic de la gaussienne)
 *   s = N / sigma                 (largeur de la gaussienne)
 *   w[j] = exp( −(j − m)² / (2·s²) ),  j = 0..N−1
 *   ALMA = Σ(w[j] · close[i−(N−1)+j]) / Σ(w[j])
 * Source : Arnaud Legoux & Dimitrios Kouzis-Loukas (2009).
 * Défauts usuels : window 9, offset 0.85, sigma 6.
 *
 * Les positions précédant la première fenêtre pleine valent `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf } from "../utils";

export const alma: IndicatorDef = {
  id: "alma",
  name: "ALMA",
  category: "trend",
  pane: "overlay",
  inputs: [
    { key: "window", name: "Window", type: "number", default: 9, min: 1 },
    { key: "offset", name: "Offset", type: "number", default: 0.85, min: 0, max: 1 },
    { key: "sigma", name: "Sigma", type: "number", default: 6, min: 0.1 },
  ],
  outputs: [{ key: "alma", name: "ALMA", style: "line" }],
  calc(candles, params) {
    const window = Number(params.window ?? 9);
    const offset = Number(params.offset ?? 0.85);
    const sigma = Number(params.sigma ?? 6);

    const close = closeOf(candles);
    const n = close.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);

    if (window <= 0 || sigma <= 0) return { series: { alma: out } };

    const m = offset * (window - 1);
    const s = window / sigma;

    // Poids gaussiens précalculés (constants pour toutes les fenêtres).
    const weights: number[] = new Array(window);
    let weightSum = 0;
    for (let j = 0; j < window; j++) {
      const w = Math.exp(-((j - m) * (j - m)) / (2 * s * s));
      weights[j] = w;
      weightSum += w;
    }
    if (weightSum === 0) return { series: { alma: out } };

    for (let i = window - 1; i < n; i++) {
      let acc = 0;
      let ok = true;
      for (let j = 0; j < window; j++) {
        const c = close[i - (window - 1) + j];
        const w = weights[j];
        if (c === undefined || w === undefined) {
          ok = false;
          break;
        }
        acc += c * w;
      }
      if (ok) out[i] = acc / weightSum;
    }

    return { series: { alma: out } };
  },
};
