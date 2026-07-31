/**
 * @axiom/indicators — volatility/historicalVol.ts
 *
 * Historical Volatility (id: historicalVol) — volatilité réalisée annualisée, %.
 *
 * Formule canonique (close-to-close, log-returns) :
 *   r[i]   = ln(close[i] / close[i-1])                 (rendement logarithmique)
 *   sd     = stdev(r, length, population = false)       (écart-type d'échantillon, N-1)
 *   HV     = sd * sqrt(annual) * 100
 *
 * Annualisation crypto : `annual = 365` (marché ouvert 365 j/an) — défaut.
 * Écart-type d'échantillon (N-1) : convention statistique standard de la HV.
 * Défaut : length = 10.
 * Source : TradingView « Historical Volatility » ; Hull, « Options, Futures... ».
 *
 * Alignement : il faut `length` rendements (donc `length + 1` bougies) pour la
 * première fenêtre pleine ; la première valeur HV apparaît à l'index `length`.
 */

import type {
  Candle,
  CalcContext,
  IndicatorDef,
  IndicatorResult,
} from "@axiom/types";
import { closeOf, stdev } from "../utils";

export const historicalVol: IndicatorDef = {
  id: "historicalVol",
  name: "Volatilité historique (HV)",
  category: "volatility",
  pane: "separate",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 10, min: 2 },
    { key: "annual", name: "Annual", type: "number", default: 365, min: 1 },
  ],
  outputs: [{ key: "hv", name: "Hist Vol %", style: "line" }],

  calc(
    candles: Candle[],
    params: Record<string, number | boolean | string>,
    _ctx: CalcContext
  ): IndicatorResult {
    const length = Number(params.length);
    const annual = Number(params.annual);

    const close = closeOf(candles);
    const n = close.length;

    // Rendements logarithmiques compacts : logRet[j] correspond à la bougie j+1.
    const logRet: number[] = [];
    for (let i = 1; i < n; i++) {
      const cur = close[i];
      const prev = close[i - 1];
      if (cur === undefined || prev === undefined || prev <= 0 || cur <= 0) {
        logRet.push(0);
        continue;
      }
      logRet.push(Math.log(cur / prev));
    }

    // Écart-type d'échantillon (N-1) sur la fenêtre `length`.
    const sd = stdev(logRet, length, false);
    const factor = Math.sqrt(annual) * 100;

    const out: Array<number | undefined> = new Array(n).fill(undefined);
    for (let j = 0; j < sd.length; j++) {
      const s = sd[j];
      if (s === undefined) continue;
      // Décalage de +1 : le rendement j provient de la bougie j+1.
      out[j + 1] = s * factor;
    }

    return { series: { hv: out } };
  },
};
