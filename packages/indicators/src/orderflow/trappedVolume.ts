/**
 * @axiom/indicators — orderflow/trappedVolume.ts
 *
 * Volume piégé au nord / au sud (« trapped longs / trapped shorts »).
 *
 * Pour chaque barre i, référence P = close[i] ; fenêtre glissante des `length`
 * barres [i−length+1, i]. Le volume de chaque bougie j est distribué
 * uniformément sur [low_j, high_j] — seule information intra-bougie disponible :
 *   fracAbove_j = clamp((high_j − P) / (high_j − low_j), 0, 1)
 *   (bougie-point high = low : 1 si tout le niveau est au-dessus de P, 0 sinon)
 *
 *   trappedLong_i  = Σ_j vol_j × fracAbove_j
 *   trappedShort_i = Σ_j vol_j × (1 − fracAbove_j)
 *
 * Lecture :
 *  - trappedLong = volume traité AU-DESSUS du prix courant : chaque unité
 *    échangée là a un acheteur désormais perdant → positions longues « bloquées
 *    au nord », réservoir de vendeurs au retour du prix (résistance).
 *  - trappedShort = volume traité EN-DESSOUS : vendeurs/shorts désormais
 *    perdants → « bloqués au sud », carburant de squeeze au retour (support).
 *  - trappedShort est émis NÉGATIF : histogramme deux faces, nord au-dessus de
 *    zéro, sud en-dessous (évite la superposition des barres).
 *
 * Universel OHLCV : pas de split acheteur/vendeur requis (sur Binance, chaque
 * trade au-dessus de P a un acheteur perdant — le volume total est la mesure).
 * Positions `undefined` tant que la fenêtre n'est pas pleine (i < length−1).
 * Complexité O(n × length) — `length` borné à 1000.
 */

import type { IndicatorDef } from "@axiom/types";
import { clampInt } from "../utils";

export const trappedVolume: IndicatorDef = {
  id: "trappedVolume",
  name: "Volume piégé (nord/sud)",
  category: "orderflow",
  pane: "separate",
  inputs: [
    { key: "length", name: "Fenêtre", type: "number", default: 96, min: 2, max: 1000 },
  ],
  outputs: [
    { key: "trappedLong", name: "Longs piégés", style: "histogram" },
    { key: "trappedShort", name: "Shorts piégés", style: "histogram" },
  ],
  precision: 0,
  calc(candles, params) {
    const length = clampInt(params.length, 96, 2, 1000);
    const n = candles.length;
    const longs: Array<number | undefined> = new Array(n).fill(undefined);
    const shorts: Array<number | undefined> = new Array(n).fill(undefined);

    for (let i = length - 1; i < n; i++) {
      const cur = candles[i];
      if (cur === undefined) continue;
      const p = cur.close;
      if (!Number.isFinite(p)) continue;

      let auDessus = 0;
      let auDessous = 0;
      for (let j = i - length + 1; j <= i; j++) {
        const c = candles[j];
        if (c === undefined) continue; // trou de données : contribution nulle
        const v = c.volume;
        if (!Number.isFinite(v) || v <= 0) continue;
        if (!Number.isFinite(c.high) || !Number.isFinite(c.low)) continue;
        const range = c.high - c.low;
        const fracAbove =
          range > 0 ? Math.min(1, Math.max(0, (c.high - p) / range)) : c.low > p ? 1 : 0;
        auDessus += v * fracAbove;
        auDessous += v * (1 - fracAbove);
      }
      longs[i] = auDessus;
      shorts[i] = -auDessous;
    }

    return { series: { trappedLong: longs, trappedShort: shorts } };
  },
};
