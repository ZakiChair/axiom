/**
 * @axiom/indicators — volume/vwap.ts
 *
 * VWAP (Volume Weighted Average Price) — prix moyen pondéré par le volume.
 *
 * VWAP de SESSION : le cumul repart de zéro à chaque changement de jour UTC
 * (`utcDayOf`, cf. utils-session.ts) — pas de dérive sur un historique long.
 * Le prix typique de chaque bougie est `hlc3 = (high + low + close) / 3`,
 * déjà fourni par le moteur via `ctx.hlc3`.
 *
 * Formule cumulative, depuis le début de la session (jour UTC courant) jusqu'à i :
 *   cumTPV[i] = Σ (tp[k] * volume[k])   pour k depuis le début du jour UTC de i
 *   cumVol[i] = Σ volume[k]             pour k depuis le début du jour UTC de i
 *   vwap[i]   = cumTPV[i] / cumVol[i]
 *
 * « Fenêtre pleine » : tant que le volume cumulé de la session vaut 0
 * (démarrage sans aucun volume), la VWAP n'est pas définie et reste
 * `undefined`. Dès la première bougie porteuse de volume dans la session, la
 * valeur devient calculable.
 */

import type { IndicatorDef } from "@axiom/types";
import { utcDayOf } from "../utils-session";

export const vwap: IndicatorDef = {
  id: "vwap",
  name: "VWAP",
  category: "volume",
  pane: "overlay",
  // Aucun paramètre : reset automatique de session à chaque jour UTC.
  inputs: [],
  outputs: [{ key: "vwap", name: "VWAP", style: "line" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);

    let cumTPV = 0; // Σ (prix typique * volume) depuis le début de la session
    let cumVol = 0; // Σ volume depuis le début de la session
    let prevDay: number | undefined; // jour UTC de la bougie précédente

    for (let i = 0; i < n; i++) {
      const c = candles[i];
      const tp = ctx.hlc3[i];
      if (c === undefined || tp === undefined) continue;

      const day = utcDayOf(c.time);
      if (prevDay !== undefined && day !== prevDay) {
        // Nouveau jour UTC : reset des accumulateurs (nouvelle session VWAP).
        cumTPV = 0;
        cumVol = 0;
      }
      prevDay = day;

      cumTPV += tp * c.volume;
      cumVol += c.volume;

      // Garde vol=0 : sans volume cumulé, la moyenne pondérée n'est pas définie.
      if (cumVol > 0) out[i] = cumTPV / cumVol;
    }

    return { series: { vwap: out } };
  },
};
