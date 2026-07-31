/**
 * @axiom/indicators — billwilliams/gator.ts
 *
 * Gator Oscillator de Bill Williams — deux histogrammes dans un pane séparé.
 * Source : « Trading Chaos » (Bill Williams). Dérivé des lignes de l'Alligator :
 *   - Histogramme HAUT  : upper[i] =  |jaw[i] - teeth[i]|   (au-dessus de zéro)
 *   - Histogramme BAS   : lower[i] = -|teeth[i] - lips[i]|  (sous zéro)
 *   où jaw/teeth/lips sont les SMMA décalées de l'Alligator (mêmes paramètres
 *   canoniques : 13/8, 8/5, 5/3 sur le prix médian hl2).
 *
 * Les lignes Alligator sont recalculées ici (fichier auto-suffisant), avec la même
 * formule que `alligator.ts`. Une valeur d'histogramme est `undefined` tant que les
 * deux lignes impliquées ne sont pas définies.
 */

import type {
  Candle,
  CalcContext,
  IndicatorDef,
  IndicatorResult,
} from "@axiom/types";
import { rma } from "../utils";

/** Décale une série vers le futur : out[i] = src[i - shift]. */
function displace(
  src: Array<number | undefined>,
  shift: number
): Array<number | undefined> {
  const n = src.length;
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  for (let i = shift; i < n; i++) {
    out[i] = src[i - shift];
  }
  return out;
}

export const gator: IndicatorDef = {
  id: "gator",
  name: "Oscillateur Gator",
  category: "billwilliams",
  pane: "separate",
  inputs: [
    { key: "jawLength", name: "Longueur Jaw", type: "number", default: 13, min: 1 },
    { key: "jawShift", name: "Décalage Jaw", type: "number", default: 8, min: 0 },
    { key: "teethLength", name: "Longueur Teeth", type: "number", default: 8, min: 1 },
    { key: "teethShift", name: "Décalage Teeth", type: "number", default: 5, min: 0 },
    { key: "lipsLength", name: "Longueur Lips", type: "number", default: 5, min: 1 },
    { key: "lipsShift", name: "Décalage Lips", type: "number", default: 3, min: 0 },
  ],
  outputs: [
    { key: "upper", name: "Haut", style: "histogram" },
    { key: "lower", name: "Bas", style: "histogram" },
  ],

  calc(
    _candles: Candle[],
    params: Record<string, number | boolean | string>,
    ctx: CalcContext
  ): IndicatorResult {
    const jawLength = Number(params.jawLength);
    const jawShift = Number(params.jawShift);
    const teethLength = Number(params.teethLength);
    const teethShift = Number(params.teethShift);
    const lipsLength = Number(params.lipsLength);
    const lipsShift = Number(params.lipsShift);

    const median = ctx.hl2;
    const n = median.length;

    const jaw = displace(rma(median, jawLength), jawShift);
    const teeth = displace(rma(median, teethLength), teethShift);
    const lips = displace(rma(median, lipsLength), lipsShift);

    const upper: Array<number | undefined> = new Array(n).fill(undefined);
    const lower: Array<number | undefined> = new Array(n).fill(undefined);

    for (let i = 0; i < n; i++) {
      const j = jaw[i];
      const t = teeth[i];
      const l = lips[i];
      if (j !== undefined && t !== undefined) upper[i] = Math.abs(j - t);
      if (t !== undefined && l !== undefined) lower[i] = -Math.abs(t - l);
    }

    return { series: { upper, lower } };
  },
};
