/**
 * @axiom/indicators — billwilliams/alligator.ts
 *
 * Alligator de Bill Williams — affiché en overlay sur le prix.
 * Source : « Trading Chaos » (Bill Williams). Formule canonique :
 *   - Jaw (mâchoire, bleu)  : SMMA(median, 13) décalée de 8 barres vers le futur
 *   - Teeth (dents, rouge)  : SMMA(median, 8)  décalée de 5 barres vers le futur
 *   - Lips (lèvres, vert)   : SMMA(median, 5)  décalée de 3 barres vers le futur
 *   où median = hl2 = (high + low) / 2 et SMMA = lissage de Wilder (rma).
 *
 * Décalage vers le futur : la valeur SMMA calculée à la barre `i` est tracée à la
 * barre `i + shift`. En sortie alignée index par index, cela revient à
 *   ligne[i] = smma[i - shift].
 * Les `shift` premières positions (et celles où la SMMA n'est pas encore amorcée)
 * valent `undefined`.
 */

import type {
  Candle,
  CalcContext,
  IndicatorDef,
  IndicatorResult,
} from "@axiom/types";
import { rma } from "../utils";

/**
 * Décale une série vers le futur de `shift` barres :
 * out[i] = src[i - shift]. Positions sans antécédent défini -> undefined.
 */
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

export const alligator: IndicatorDef = {
  id: "alligator",
  name: "Alligator",
  category: "billwilliams",
  pane: "overlay",
  inputs: [
    { key: "jawLength", name: "Longueur Jaw", type: "number", default: 13, min: 1 },
    { key: "jawShift", name: "Décalage Jaw", type: "number", default: 8, min: 0 },
    { key: "teethLength", name: "Longueur Teeth", type: "number", default: 8, min: 1 },
    { key: "teethShift", name: "Décalage Teeth", type: "number", default: 5, min: 0 },
    { key: "lipsLength", name: "Longueur Lips", type: "number", default: 5, min: 1 },
    { key: "lipsShift", name: "Décalage Lips", type: "number", default: 3, min: 0 },
  ],
  outputs: [
    { key: "jaw", name: "Jaw", style: "line" },
    { key: "teeth", name: "Teeth", style: "line" },
    { key: "lips", name: "Lips", style: "line" },
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

    // Prix médian (hl2) déjà fourni par le moteur.
    const median = ctx.hl2;

    const jaw = displace(rma(median, jawLength), jawShift);
    const teeth = displace(rma(median, teethLength), teethShift);
    const lips = displace(rma(median, lipsLength), lipsShift);

    return { series: { jaw, teeth, lips } };
  },
};
