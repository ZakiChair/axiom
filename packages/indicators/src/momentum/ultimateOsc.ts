/**
 * @axiom/indicators — momentum/ultimateOsc.ts
 *
 * Ultimate Oscillator (Larry Williams, 1976).
 *
 * Source : formule canonique (Williams, reprise par TradingView / pandas-ta).
 *
 * Calcul (à partir de l'index 1, car BP/TR utilisent la clôture précédente) :
 *   BP[i]  = close[i] - min(low[i], close[i-1])                  (Buying Pressure)
 *   TR[i]  = max(high[i], close[i-1]) - min(low[i], close[i-1])  (True Range)
 *   avgK   = Σ(BP, K) / Σ(TR, K)   pour K ∈ {fast, mid, slow}
 *   UO     = 100 * (w1·avgFast + w2·avgMid + w3·avgSlow) / (w1 + w2 + w3)
 *
 * Pondérations canoniques : fast=7 (w1=4), mid=14 (w2=2), slow=28 (w3=1).
 * Borné 0..100.
 *
 * Alignement : la première valeur exige `slow` mesures BP/TR (qui débutent à
 * l'index 1), soit l'index `slow`. Les positions précédentes valent `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";
import { rollingSum } from "../utils";

export const ultimateOsc: IndicatorDef = {
  id: "ultimateOsc",
  name: "Ultimate Oscillator",
  category: "momentum",
  pane: "separate",
  inputs: [
    { key: "fast", name: "Rapide", type: "number", default: 7, min: 1 },
    { key: "mid", name: "Mid", type: "number", default: 14, min: 1 },
    { key: "slow", name: "Lente", type: "number", default: 28, min: 1 },
  ],
  outputs: [{ key: "uo", name: "UO", style: "line" }],

  calc(candles, params) {
    // Quantifie : `start = max(fast,mid,slow)` fractionnaire n'atteint aucun index entier.
    const fast = Math.round(Number(params.fast));
    const mid = Math.round(Number(params.mid));
    const slow = Math.round(Number(params.slow));
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);

    // Buying Pressure et True Range alignés sur la bougie courante (index 0 = 0).
    const bp: number[] = new Array(n).fill(0);
    const tr: number[] = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
      const c = candles[i];
      const prev = candles[i - 1];
      if (c === undefined || prev === undefined) continue;
      const minLC = Math.min(c.low, prev.close);
      const maxHC = Math.max(c.high, prev.close);
      bp[i] = c.close - minLC;
      tr[i] = maxHC - minLC;
    }

    const bpFast = rollingSum(bp, fast);
    const trFast = rollingSum(tr, fast);
    const bpMid = rollingSum(bp, mid);
    const trMid = rollingSum(tr, mid);
    const bpSlow = rollingSum(bp, slow);
    const trSlow = rollingSum(tr, slow);

    const w1 = 4;
    const w2 = 2;
    const w3 = 1;
    const wSum = w1 + w2 + w3;

    // On ne publie qu'à partir de l'index slow (BP/TR commencent à l'index 1).
    const start = Math.max(fast, mid, slow);
    for (let i = start; i < n; i++) {
      const tf = trFast[i];
      const tm = trMid[i];
      const ts = trSlow[i];
      const bf = bpFast[i];
      const bm = bpMid[i];
      const bs = bpSlow[i];
      if (
        tf === undefined || tm === undefined || ts === undefined ||
        bf === undefined || bm === undefined || bs === undefined
      ) {
        continue;
      }
      // True Range nul -> avg indéfini : on retombe sur une valeur neutre (0).
      const avgFast = tf === 0 ? 0 : bf / tf;
      const avgMid = tm === 0 ? 0 : bm / tm;
      const avgSlow = ts === 0 ? 0 : bs / ts;
      out[i] = (100 * (w1 * avgFast + w2 * avgMid + w3 * avgSlow)) / wSum;
    }

    return { series: { uo: out } };
  },
};
