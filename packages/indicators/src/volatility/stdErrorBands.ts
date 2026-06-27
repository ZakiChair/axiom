/**
 * @axiom/indicators — volatility/stdErrorBands.ts
 *
 * Standard Error Bands (id: stdErrorBands) — bandes de régression linéaire,
 * superposées au prix (Jon Andersen).
 *
 * Formule canonique :
 *   Sur la fenêtre de `length` clôtures (x = 0..length-1, y = close) :
 *     pente   b = (L·Σxy − Σx·Σy) / (L·Σx² − (Σx)²)
 *     ordonnée a = (Σy − b·Σx) / L
 *     basis     = a + b·(L-1)                 (valeur de régression en bout de fenêtre)
 *     SSE       = Σy² − a·Σy − b·Σxy           (somme des carrés des résidus)
 *     SEE       = sqrt(SSE / (L − 2))          (erreur standard de l'estimation)
 *     upper     = basis + mult · SEE
 *     lower     = basis − mult · SEE
 *
 * Défauts : length = 21, mult = 2.
 * Source : Jon Andersen, « Standard Error Bands » (Stocks & Commodities, 1996).
 * Remarque : la version d'origine ajoute un lissage SMA(3) sur la ligne et les
 * bandes ; ce raccourci canonique l'omet (bandes non lissées).
 *
 * Alignement : il faut `length` clôtures (et length >= 3 pour SEE) ; les
 * `length - 1` premières positions valent undefined.
 */

import type {
  Candle,
  CalcContext,
  IndicatorDef,
  IndicatorResult,
} from "@axiom/types";
import { closeOf } from "../utils";

export const stdErrorBands: IndicatorDef = {
  id: "stdErrorBands",
  name: "Standard Error Bands",
  category: "volatility",
  pane: "overlay",
  inputs: [
    { key: "length", name: "Length", type: "number", default: 21, min: 3 },
    { key: "mult", name: "Multiplier", type: "number", default: 2, min: 0 },
  ],
  outputs: [
    { key: "basis", name: "Basis", style: "line" },
    { key: "upper", name: "Upper", style: "line" },
    { key: "lower", name: "Lower", style: "line" },
  ],

  calc(
    candles: Candle[],
    params: Record<string, number | boolean | string>,
    _ctx: CalcContext
  ): IndicatorResult {
    const length = Number(params.length);
    const mult = Number(params.mult);

    const close = closeOf(candles);
    const n = close.length;

    const basis: Array<number | undefined> = new Array(n).fill(undefined);
    const upper: Array<number | undefined> = new Array(n).fill(undefined);
    const lower: Array<number | undefined> = new Array(n).fill(undefined);

    // Sommes sur x = 0..length-1 (indépendantes des données).
    const sumX = ((length - 1) * length) / 2;
    const sumX2 = ((length - 1) * length * (2 * length - 1)) / 6;
    const denom = length * sumX2 - sumX * sumX;
    if (denom === 0 || length < 3) {
      return { series: { basis, upper, lower } };
    }

    for (let i = length - 1; i < n; i++) {
      let sumY = 0;
      let sumXY = 0;
      let sumY2 = 0;
      let valid = true;
      for (let k = 0; k < length; k++) {
        const y = close[i - length + 1 + k];
        if (y === undefined) {
          valid = false;
          break;
        }
        sumY += y;
        sumXY += k * y;
        sumY2 += y * y;
      }
      if (!valid) continue;

      const b = (length * sumXY - sumX * sumY) / denom;
      const a = (sumY - b * sumX) / length;
      const mid = a + b * (length - 1);

      // SSE = Σ(y - ŷ)² = Σy² - a·Σy - b·Σxy (forme calculatoire).
      let sse = sumY2 - a * sumY - b * sumXY;
      if (sse < 0) sse = 0; // garde contre les erreurs flottantes
      const see = Math.sqrt(sse / (length - 2));
      const offset = mult * see;

      basis[i] = mid;
      upper[i] = mid + offset;
      lower[i] = mid - offset;
    }

    return { series: { basis, upper, lower } };
  },
};
