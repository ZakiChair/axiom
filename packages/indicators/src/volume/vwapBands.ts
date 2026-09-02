/**
 * @axiom/indicators — volume/vwapBands.ts
 *
 * VWAP Bands — VWAP de session encadrée par ± k écarts-types pondérés volume.
 * Source : TradingView "VWAP with standard deviation bands".
 *
 * Session = jour UTC courant (`utcDayOf`, cf. utils-session.ts) : les trois
 * accumulateurs repartent de zéro à chaque changement de jour UTC, en phase
 * avec le reset de vwap.ts.
 *
 * Formules cumulatives (depuis le début de la session) :
 *   tp[i]     = hlc3 (fourni par ctx.hlc3)
 *   cumTPV    = Σ tp*vol ; cumVol = Σ vol ; cumTP2V = Σ tp²*vol
 *   vwap[i]   = cumTPV / cumVol
 *   var[i]    = cumTP2V / cumVol - vwap²       (variance pondérée volume, clampée ≥ 0)
 *   upper[i]  = vwap + mult * sqrt(var)
 *   lower[i]  = vwap - mult * sqrt(var)
 *
 * Indéfini tant que le volume cumulé de la session vaut 0 (cf. vwap.ts).
 * Invariant garanti : upper ≥ basis ≥ lower.
 *
 * SESSION TRONQUÉE : même convention que vwap.ts — buffer ne démarrant pas à
 * 00:00 UTC = étiquette « Session partielle » sur la première bougie, valeurs
 * conservées (jamais de pane muet).
 */

import type { AnnotationsIndicateur, IndicatorDef } from "@axiom/types";
import { debutSessionPartiel, etiquetteSessionPartielle, utcDayOf } from "../utils-session";

export const vwapBands: IndicatorDef = {
  id: "vwapBands",
  name: "Bandes VWAP",
  category: "volume",
  pane: "overlay",
  inputs: [
    { key: "mult", name: "Multiplicateur σ", type: "number", default: 1, min: 0 },
  ],
  outputs: [
    { key: "basis", name: "VWAP", style: "line" },
    { key: "upper", name: "Bande sup.", style: "band" },
    { key: "lower", name: "Bande inf.", style: "band" },
  ],
  calc(candles, params, ctx) {
    const mult = Number(params.mult ?? 1);
    const n = candles.length;
    const basis: Array<number | undefined> = new Array(n).fill(undefined);
    const upper: Array<number | undefined> = new Array(n).fill(undefined);
    const lower: Array<number | undefined> = new Array(n).fill(undefined);

    let cumTPV = 0;
    let cumVol = 0;
    let cumTP2V = 0;
    let prevDay: number | undefined; // jour UTC de la bougie précédente

    for (let i = 0; i < n; i++) {
      const c = candles[i];
      const tp = ctx.hlc3[i];
      if (c === undefined || tp === undefined) continue;

      const day = utcDayOf(c.time);
      if (prevDay !== undefined && day !== prevDay) {
        // Nouveau jour UTC : reset des 3 accumulateurs (nouvelle session).
        cumTPV = 0;
        cumVol = 0;
        cumTP2V = 0;
      }
      prevDay = day;

      cumTPV += tp * c.volume;
      cumTP2V += tp * tp * c.volume;
      cumVol += c.volume;

      if (cumVol > 0) {
        const vwap = cumTPV / cumVol;
        let variance = cumTP2V / cumVol - vwap * vwap;
        if (variance < 0) variance = 0; // garde flottante (cf. stdev de utils.ts)
        const sd = Math.sqrt(variance);
        basis[i] = vwap;
        upper[i] = vwap + mult * sd;
        lower[i] = vwap - mult * sd;
      }
    }

    const series = { basis, upper, lower };
    if (!debutSessionPartiel(candles)) return { series };
    const annotations: AnnotationsIndicateur = {
      labels: [etiquetteSessionPartielle(candles, basis)],
    };
    return { series, annotations };
  },
};
