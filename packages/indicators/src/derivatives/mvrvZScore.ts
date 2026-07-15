/**
 * @axiom/indicators — derivatives/mvrvZScore.ts
 *
 * MVRV Z-Score — normalisation du ratio MVRV par rapport à sa propre distribution
 * récente : signal de sur/sous-évaluation cyclique (extrêmes = sommets/creux macro).
 *
 * NOTE : le MVRV Z-Score « canonique » de Glassnode = (market cap − realized cap) /
 * stdev(market cap). La realized cap n'est PAS servie gratuitement (Coin Metrics
 * community renvoie 403 sur CapRealUSD). On calcule donc le Z-Score du RATIO MVRV
 * lui-même (série aux `mvrv` = CapMVRVCur), qui capture le même signal cyclique de
 * façon normalisée et 100 % gratuite.
 *
 * Formule (identique à Funding Z-Score, sur la série mvrv) :
 *   z[i] = (mvrv[i] − mean(fenêtre)) / stdev(fenêtre)
 * `undefined` tant que moins de `window` points définis ne sont disponibles ;
 * z = 0 si l'écart-type de la fenêtre est nul (évite 0/0).
 */

import type { IndicatorDef } from "@axiom/types";
import { stdev } from "../utils";

export const mvrvZScore: IndicatorDef = {
  id: "mvrvZScore",
  name: "MVRV Z-Score",
  category: "derivatives",
  pane: "separate",
  aux: ["mvrv"],
  minTimeframe: "1d",
  inputs: [{ key: "window", name: "Fenêtre", type: "number", default: 100, min: 10, max: 500 }],
  outputs: [{ key: "mvrvZScore", name: "MVRV Z-Score", style: "line" }],
  calc(candles, params, ctx) {
    const n = candles.length;
    const window = Number(params.window ?? 100);
    const out: Array<number | undefined> = new Array(n).fill(undefined);

    const mvrv = ctx.aux?.mvrv;
    if (!mvrv || window <= 0) return { series: { mvrvZScore: out } };

    for (let i = 0; i < n; i++) {
      const current = mvrv[i];
      if (current === undefined) continue;

      // Remonte depuis i pour collecter les `window` derniers points définis.
      const win: number[] = [];
      for (let j = i; j >= 0 && win.length < window; j--) {
        const v = mvrv[j];
        if (v !== undefined) win.unshift(v);
      }
      if (win.length < window) continue; // fenêtre incomplète

      const mean = win.reduce((a, b) => a + b, 0) / win.length;
      const sd = stdev(win, win.length)[win.length - 1];
      if (sd === undefined) continue;
      out[i] = sd === 0 ? 0 : (current - mean) / sd;
    }

    return { series: { mvrvZScore: out } };
  },
};
