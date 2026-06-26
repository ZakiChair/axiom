/**
 * @axiom/indicators — volume/vwap.ts
 *
 * VWAP (Volume Weighted Average Price) — prix moyen pondéré par le volume.
 *
 * MVP : VWAP de session calculée sur l'intégralité du jeu de bougies fourni
 * (pas de reset de session — celui-ci viendra plus tard). Le prix typique de
 * chaque bougie est `hlc3 = (high + low + close) / 3`, déjà fourni par le moteur
 * via `ctx.hlc3`.
 *
 * Formule cumulative, du premier index jusqu'à i :
 *   cumTPV[i] = Σ (tp[k] * volume[k])   pour k de 0 à i
 *   cumVol[i] = Σ volume[k]             pour k de 0 à i
 *   vwap[i]   = cumTPV[i] / cumVol[i]
 *
 * « Fenêtre pleine » : tant que le volume cumulé vaut 0 (démarrage sans aucun
 * volume), la VWAP n'est pas définie et reste `undefined`. Dès la première
 * bougie porteuse de volume, la valeur devient calculable.
 */

import type { IndicatorDef } from "@axiom/types";

export const vwap: IndicatorDef = {
  id: "vwap",
  name: "VWAP",
  category: "volume",
  pane: "overlay",
  // Aucun paramètre pour le MVP : session unique sur tout le jeu fourni.
  inputs: [],
  outputs: [{ key: "vwap", name: "VWAP", style: "line" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);

    let cumTPV = 0; // Σ (prix typique * volume)
    let cumVol = 0; // Σ volume

    for (let i = 0; i < n; i++) {
      const c = candles[i];
      const tp = ctx.hlc3[i];
      if (c === undefined || tp === undefined) continue;

      cumTPV += tp * c.volume;
      cumVol += c.volume;

      // Garde vol=0 : sans volume cumulé, la moyenne pondérée n'est pas définie.
      if (cumVol > 0) out[i] = cumTPV / cumVol;
    }

    return { series: { vwap: out } };
  },
};
