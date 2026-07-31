/**
 * @axiom/indicators — momentum/ppo.ts
 *
 * PPO (Percentage Price Oscillator).
 *
 * Source : formule canonique (variante en % du MACD, reprise par TradingView /
 * pandas-ta).
 *
 * Calcul :
 *   ppo[i]    = 100 * (EMA(close, fast) - EMA(close, slow)) / EMA(close, slow)
 *   signal    = EMA(ppo, signal)        (EMA des valeurs définies de la ligne PPO)
 *
 * Paramètres canoniques : fast = 12, slow = 26, signal = 9.
 *
 * Alignement : la ligne PPO débute quand l'EMA lente existe (index `slow - 1`) ;
 * la ligne signal ajoute le démarrage de sa propre EMA. Positions sans valeur =
 * `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf, ema } from "../utils";

export const ppo: IndicatorDef = {
  id: "ppo",
  name: "PPO",
  category: "momentum",
  pane: "separate",
  inputs: [
    { key: "fast", name: "Rapide", type: "number", default: 12, min: 1 },
    { key: "slow", name: "Lente", type: "number", default: 26, min: 1 },
    { key: "signal", name: "Signal", type: "number", default: 9, min: 1 },
  ],
  outputs: [
    { key: "ppo", name: "PPO", style: "line" },
    { key: "signal", name: "Signal", style: "line" },
  ],

  calc(candles, params) {
    const fast = Number(params.fast);
    const slow = Number(params.slow);
    const signalLen = Number(params.signal);
    const closes = closeOf(candles);
    const n = closes.length;

    const fastEma = ema(closes, fast);
    const slowEma = ema(closes, slow);

    // Ligne PPO : écart relatif (%) des deux EMA, défini tant que l'EMA lente existe.
    const ppoLine: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const f = fastEma[i];
      const s = slowEma[i];
      if (f === undefined || s === undefined || s === 0) continue;
      ppoLine[i] = (100 * (f - s)) / s;
    }

    // Ligne signal : EMA des seules valeurs définies de la ligne PPO, ré-alignée.
    const definedIdx: number[] = [];
    const definedVals: number[] = [];
    for (let i = 0; i < n; i++) {
      const v = ppoLine[i];
      if (v !== undefined) {
        definedIdx.push(i);
        definedVals.push(v);
      }
    }
    const signalCompact = ema(definedVals, signalLen);
    const signalLine: Array<number | undefined> = new Array(n).fill(undefined);
    for (let j = 0; j < definedIdx.length; j++) {
      const idx = definedIdx[j];
      if (idx === undefined) continue;
      signalLine[idx] = signalCompact[j];
    }

    return { series: { ppo: ppoLine, signal: signalLine } };
  },
};
