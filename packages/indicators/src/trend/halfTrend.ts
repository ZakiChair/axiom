/**
 * @axiom/indicators — trend/halfTrend.ts
 *
 * HalfTrend (règle canonique Everget) — suiveur ATR :
 *   bascule BAISSIÈRE si SMA(high, amplitude) < maxLowPrice (plus haut des
 *   creux ratcheté) ET close < low[1] ; miroir pour la bascule haussière.
 *   maxLowPrice/minHighPrice sont ratchetés sur les extrêmes ROULANTS
 *   (plus bas/plus haut des `amplitude` dernières barres).
 * Écart assumé vs Everget : la LIGNE est décalée de ±dev (dev = ATR·amplitude/2)
 * alors que le canonique trace up/down sans décalage et réserve dev au canal
 * atrHigh/atrLow (non exposé ici) — sans quoi l'input atrPeriod serait mort.
 * La règle de BASCULE, elle, est canonique.
 * Overlay : `line` + `direction` (+1 / −1).
 */

import type { IndicatorDef } from "@axiom/types";
import { highOf, lowOf, rma, rollingHighest, rollingLowest, sma, trueRange } from "../utils";

export const halfTrend: IndicatorDef = {
  id: "halfTrend",
  name: "HalfTrend",
  category: "trend",
  pane: "overlay",
  inputs: [
    { key: "amplitude", name: "Amplitude", type: "number", default: 2, min: 1, max: 20 },
    { key: "atrPeriod", name: "ATR période", type: "number", default: 100, min: 2, max: 200 },
  ],
  outputs: [
    { key: "line", name: "HalfTrend", style: "line" },
    { key: "direction", name: "Direction", style: "line" },
  ],
  calc(candles, params) {
    const amplitude = Math.max(1, Math.floor(Number(params.amplitude) || 2));
    const atrPeriod = Math.max(2, Math.floor(Number(params.atrPeriod) || 100));
    const n = candles.length;
    const line: Array<number | undefined> = new Array(n).fill(undefined);
    const direction: Array<number | undefined> = new Array(n).fill(undefined);
    const atrVals = rma(trueRange(candles), atrPeriod);
    const highs = highOf(candles);
    const lows = lowOf(candles);
    // Briques canoniques Everget : SMA(high/low, amplitude) pour la condition
    // de bascule, extrêmes roulants pour le ratchet maxLow/minHigh.
    const smaHigh = sma(highs, amplitude);
    const smaLow = sma(lows, amplitude);
    const plusHaut = rollingHighest(highs, amplitude);
    const plusBas = rollingLowest(lows, amplitude);

    // 0 = up, 1 = down (convention Pine halfTrend)
    let trend = 0;
    let nextTrend = 0;
    let maxLowPrice = Number.NaN;
    let minHighPrice = Number.NaN;
    let up = Number.NaN;
    let down = Number.NaN;

    for (let i = 0; i < n; i++) {
      const c = candles[i];
      const atr = atrVals[i];
      if (c === undefined || atr === undefined) continue;
      const hma = smaHigh[i];
      const lma = smaLow[i];
      const highPrice = plusHaut[i];
      const lowPrice = plusBas[i];
      // atrPeriod ≥ amplitude en pratique (défauts 100 vs 2) mais les gardes
      // restent explicites (noUncheckedIndexedAccess).
      if (hma === undefined || lma === undefined || highPrice === undefined || lowPrice === undefined) {
        continue;
      }

      const close = c.close;
      const dev = (atr * amplitude) / 2;
      const prev = candles[i - 1];
      const prevLow = prev?.low ?? c.low; // nz(low[1], low)
      const prevHigh = prev?.high ?? c.high; // nz(high[1], high)

      if (Number.isNaN(maxLowPrice)) maxLowPrice = prevLow;
      if (Number.isNaN(minHighPrice)) minHighPrice = prevHigh;

      if (nextTrend === 1) {
        maxLowPrice = Math.max(lowPrice, maxLowPrice);
        // Bascule baissière canonique : SMA des highs passée SOUS le plus haut
        // des creux ratcheté ET close sous le low précédent.
        if (hma < maxLowPrice && close < prevLow) {
          trend = 1;
          nextTrend = 0;
          minHighPrice = highPrice;
        }
      } else {
        minHighPrice = Math.min(highPrice, minHighPrice);
        // Bascule haussière canonique (miroir).
        if (lma > minHighPrice && close > prevHigh) {
          trend = 0;
          nextTrend = 1;
          maxLowPrice = lowPrice;
        }
      }

      if (trend === 0) {
        const candidate = maxLowPrice - dev;
        if (Number.isNaN(up)) up = candidate;
        else {
          // au basculement depuis down, reprend l'ancien down
          const prevDir = direction[i - 1];
          if (prevDir === -1 && !Number.isNaN(down)) up = down;
          else up = Math.max(candidate, up);
        }
        line[i] = up;
        direction[i] = 1;
      } else {
        const candidate = minHighPrice + dev;
        if (Number.isNaN(down)) down = candidate;
        else {
          const prevDir = direction[i - 1];
          if (prevDir === 1 && !Number.isNaN(up)) down = up;
          else down = Math.min(candidate, down);
        }
        line[i] = down;
        direction[i] = -1;
      }
    }

    return { series: { line, direction } };
  },
};
