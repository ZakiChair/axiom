/**
 * @axiom/indicators — volume/volumeMa.ts
 *
 * Volume MA — moyenne mobile simple du volume.
 * Source : usage standard (overlay de moyenne sur l'histogramme de volume).
 *
 * Formule : volumeMa[i] = SMA(volume, length)[i]
 *   Les `length - 1` premières positions valent `undefined` (fenêtre incomplète).
 */

import type { IndicatorDef } from "@axiom/types";
import { volOf, sma } from "../utils";

export const volumeMa: IndicatorDef = {
  id: "volumeMa",
  name: "MM Volume",
  category: "volume",
  pane: "separate",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 20, min: 1 },
  ],
  outputs: [{ key: "volumeMa", name: "MM Volume", style: "line" }],
  calc(candles, params) {
    const length = Number(params.length ?? 20);
    const out = sma(volOf(candles), length);
    return { series: { volumeMa: out } };
  },
};
