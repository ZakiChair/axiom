/**
 * @axiom/indicators — trend/gannHilo.ts
 *
 * Gann HiLo Activator — ligne de suivi de tendance qui bascule entre la moyenne des
 * hauts et celle des bas :
 *   sHigh = SMA(high, n) ; sLow = SMA(low, n)
 *   tendance HAUSSIÈRE quand close > sHigh ; BAISSIÈRE quand close < sLow ; sinon inchangée
 *   HiLo = tendance haussière ? sLow (support suiveur) : sHigh (résistance suiveuse)
 * Le prix qui repasse de l'autre côté de la ligne signale un retournement.
 *
 * Défaut n=10. Overlay, une ligne. Réutilise `sma` (utils). État initialisé au 1er
 * point où la SMA est définie (tendance = close vs médiane sHigh/sLow).
 */

import type { Candle, CalcContext, IndicatorDef, IndicatorResult } from "@axiom/types";
import { closeOf, highOf, lowOf, sma } from "../utils";

export const gannHilo: IndicatorDef = {
  id: "gannHilo",
  name: "Gann HiLo Activator",
  category: "trend",
  pane: "overlay",
  inputs: [{ key: "length", name: "Longueur", type: "number", default: 10, min: 1 }],
  outputs: [{ key: "hilo", name: "HiLo", style: "line" }],
  calc(candles: Candle[], params: Record<string, number | boolean | string>, _ctx: CalcContext): IndicatorResult {
    const length = Number(params.length);
    const n = candles.length;
    const close = closeOf(candles);
    const sHigh = sma(highOf(candles), length);
    const sLow = sma(lowOf(candles), length);

    const out: Array<number | undefined> = new Array(n).fill(undefined);
    let hlv: 1 | -1 | 0 = 0; // 0 = pas encore initialisé
    for (let i = 0; i < n; i++) {
      const c = close[i];
      const sh = sHigh[i];
      const sl = sLow[i];
      if (c === undefined || sh === undefined || sl === undefined) continue;
      if (hlv === 0) {
        // Initialisation : au-dessus de la médiane des MM → haussier, sinon baissier.
        hlv = c >= (sh + sl) / 2 ? 1 : -1;
      } else if (c > sh) {
        hlv = 1;
      } else if (c < sl) {
        hlv = -1;
      }
      out[i] = hlv === 1 ? sl : sh;
    }
    return { series: { hilo: out } };
  },
};
