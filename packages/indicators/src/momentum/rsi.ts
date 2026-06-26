/**
 * @axiom/indicators — momentum/rsi.ts
 *
 * RSI (Relative Strength Index) de Wilder.
 *
 * Calcul :
 *   deltas  = close[i] - close[i-1]
 *   gains   = max(delta, 0)
 *   pertes  = max(-delta, 0)
 *   avgGain = rma(gains, length)   (lissage de Wilder)
 *   avgLoss = rma(pertes, length)
 *   RS      = avgGain / avgLoss
 *   RSI     = 100 - 100 / (1 + RS)
 *   Cas particulier : avgLoss == 0  ->  RSI = 100 (aucune perte sur la fenêtre).
 *
 * Alignement : les `length` premières positions (avant la première fenêtre RMA
 * pleine) restent `undefined`. La première valeur RSI apparaît à l'index `length`
 * (il faut `length` deltas, donc `length + 1` bougies).
 */

import type {
  Candle,
  CalcContext,
  IndicatorDef,
  IndicatorResult,
} from "@axiom/types";
import { closeOf, rma } from "../utils";

export const rsi: IndicatorDef = {
  id: "rsi",
  name: "RSI",
  category: "momentum",
  pane: "separate",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 14, min: 1 },
  ],
  outputs: [{ key: "rsi", name: "RSI", style: "line" }],

  calc(
    candles: Candle[],
    params: Record<string, number | boolean | string>,
    _ctx: CalcContext
  ): IndicatorResult {
    const length = Number(params.length);
    const closes = closeOf(candles);
    const n = closes.length;

    const out: Array<number | undefined> = new Array(n).fill(undefined);

    // Deltas alignés : gains[j] / losses[j] correspondent à la bougie j+1.
    const gains: number[] = [];
    const losses: number[] = [];
    for (let i = 1; i < n; i++) {
      const cur = closes[i];
      const prev = closes[i - 1];
      if (cur === undefined || prev === undefined) {
        gains.push(0);
        losses.push(0);
        continue;
      }
      const delta = cur - prev;
      gains.push(delta > 0 ? delta : 0);
      losses.push(delta < 0 ? -delta : 0);
    }

    const avgGain = rma(gains, length);
    const avgLoss = rma(losses, length);

    for (let j = 0; j < gains.length; j++) {
      const g = avgGain[j];
      const l = avgLoss[j];
      if (g === undefined || l === undefined) continue;
      // avgLoss == 0 -> RS infini -> RSI = 100 (pas de gestion de division par 0).
      const value = l === 0 ? 100 : 100 - 100 / (1 + g / l);
      // Décalage de +1 : le delta j provient de la bougie j+1.
      out[j + 1] = value;
    }

    return { series: { rsi: out } };
  },
};
