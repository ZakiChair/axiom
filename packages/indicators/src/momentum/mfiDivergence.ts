/**
 * @axiom/indicators — momentum/mfiDivergence.ts
 *
 * Divergences MFI ↔ prix (lot v2.1, via la fabrique commune). Le MFI (`mfiOf`)
 * est un « RSI pondéré par le volume » — il combine le prix typique (hlc3) et le
 * volume, ce qui en fait une divergence plus exigeante que le RSI seul : une
 * divergence MFI trahit un essoufflement du prix confirmé par le volume, pas
 * seulement par la variation de cours. Catégorie `strategy` depuis le lot v2.2
 * (déplacée hors `momentum`, où elle était alignée sur le def de base `mfi` —
 * amendement n°2 du spec v2.1). Rendu : courbe en pane séparé +
 * segments/labels/tooltips du canal d'annotations.
 */

import { defDivergenceOscillateur } from "../utils-fabrique-divergence";
import { mfiOf } from "./mfi";

export const mfiDivergence = defDivergenceOscillateur({
  id: "mfiDivergence",
  name: "MFI Divergence",
  category: "strategy",
  precision: 2,
  serieOsc: { key: "mfi", name: "MFI" },
  inputsOsc: [{ key: "length", name: "Longueur", type: "number", default: 14, min: 1 }],
  oscillateur: (candles, params, ctx) => mfiOf(candles, ctx.hlc3, Number(params.length ?? 14)),
});
