/**
 * @axiom/indicators — trend/sslChannel.ts
 *
 * SSL Channel (Semaphore Signal Level) — deux moyennes des high/low basculées
 * selon la position du close :
 *   Hlv = +1 si close > sma(high) ; −1 si close < sma(low) ; sinon conserve
 *   sslUp / sslDown = sma(high) et sma(low) permutées selon Hlv
 * Overlay simple, très utilisé en crypto retail (gratuit).
 */

import type { IndicatorDef } from "@axiom/types";
import { highOf, lowOf, sma } from "../utils";

export const sslChannel: IndicatorDef = {
  id: "sslChannel",
  name: "SSL Channel",
  category: "trend",
  pane: "overlay",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 10, min: 2, max: 200 },
  ],
  outputs: [
    { key: "sslUp", name: "SSL Up", style: "line" },
    { key: "sslDown", name: "SSL Down", style: "line" },
  ],
  calc(candles, params) {
    const length = Math.max(2, Math.floor(Number(params.length) || 10));
    const smaHigh = sma(highOf(candles), length);
    const smaLow = sma(lowOf(candles), length);
    const n = candles.length;
    const sslUp: Array<number | undefined> = new Array(n).fill(undefined);
    const sslDown: Array<number | undefined> = new Array(n).fill(undefined);
    let hlv = 0;

    for (let i = 0; i < n; i++) {
      const c = candles[i];
      const sh = smaHigh[i];
      const sl = smaLow[i];
      if (c === undefined || sh === undefined || sl === undefined) continue;
      if (c.close > sh) hlv = 1;
      else if (c.close < sl) hlv = -1;
      // sinon conserve hlv
      if (hlv === 0) {
        // amorce : au-dessus du milieu des deux SMA
        hlv = c.close >= (sh + sl) / 2 ? 1 : -1;
      }
      if (hlv < 0) {
        sslDown[i] = sh;
        sslUp[i] = sl;
      } else {
        sslDown[i] = sl;
        sslUp[i] = sh;
      }
    }
    return { series: { sslUp, sslDown } };
  },
};
