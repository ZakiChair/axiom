/**
 * @axiom/indicators — momentum/easeOfMovement.ts
 *
 * Ease of Movement (EMV) — Richard W. Arms Jr.
 * Relie le déplacement du prix au volume : un fort déplacement avec peu de
 * volume traduit une « facilité de mouvement » élevée.
 *
 * Formule canonique (length par défaut = 14) :
 *   hl2[i]      = (high[i] + low[i]) / 2
 *   distance    = hl2[i] - hl2[i-1]
 *   boxRatio    = volume[i] / (high[i] - low[i])
 *   emv1[i]     = distance / boxRatio = (hl2[i] - hl2[i-1]) * (high[i] - low[i]) / volume[i]
 *   EMV         = SMA(emv1, length)
 *
 * emv1 n'est défini qu'à partir de la bougie 1 (il faut un hl2 précédent).
 * Bougie dégénérée (high == low ou volume == 0) : emv1 `undefined`.
 * La SMA est stricte : la fenêtre doit être entièrement définie, sinon `undefined`.
 * Première sortie possible à l'index `length` (fenêtre [1 .. length] pleine).
 */

import type { IndicatorDef } from "@axiom/types";
import { highOf, lowOf, volOf } from "../utils";

export const easeOfMovement: IndicatorDef = {
  id: "easeOfMovement",
  name: "Ease of Movement",
  category: "momentum",
  pane: "separate",
  inputs: [
    { key: "length", name: "Longueur SMA", type: "number", default: 14, min: 1 },
  ],
  outputs: [{ key: "emv", name: "EMV", style: "line" }],

  calc(candles, params, ctx) {
    const length = Number(params.length ?? 14);
    const n = candles.length;
    const hl2 = ctx.hl2; // (high + low) / 2 fourni par le moteur
    const highs = highOf(candles);
    const lows = lowOf(candles);
    const vols = volOf(candles);

    // emv1 : déplacement / box ratio, défini dès la bougie 1.
    const emv1: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 1; i < n; i++) {
      const cur = hl2[i];
      const prev = hl2[i - 1];
      const h = highs[i];
      const l = lows[i];
      const v = vols[i];
      if (
        cur === undefined ||
        prev === undefined ||
        h === undefined ||
        l === undefined ||
        v === undefined
      ) {
        continue;
      }
      const range = h - l;
      // box ratio nul/indéfini : bougie sans amplitude ou sans volume.
      if (range === 0 || v === 0) continue;
      emv1[i] = ((cur - prev) * range) / v;
    }

    // SMA stricte : fenêtre entièrement définie requise.
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (length > 0) {
      for (let i = length; i < n; i++) {
        let sum = 0;
        let full = true;
        for (let k = i - length + 1; k <= i; k++) {
          const v = emv1[k];
          if (v === undefined) {
            full = false;
            break;
          }
          sum += v;
        }
        if (full) out[i] = sum / length;
      }
    }

    return { series: { emv: out } };
  },
};
