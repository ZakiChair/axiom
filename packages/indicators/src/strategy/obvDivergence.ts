/**
 * @axiom/indicators — strategy/obvDivergence.ts
 *
 * Divergences OBV ↔ prix (lot v2.1, via la fabrique commune). L'OBV (`obvOf`)
 * cumule le volume signé par le sens de la clôture : une confirmation de
 * tendance par le volume qui décroche du prix (prix en plus bas, OBV en plus
 * haut) trahit un flux acheteur/vendeur qui ne suit plus le mouvement — signal
 * de divergence classique en analyse volume. Aucun paramètre propre (l'OBV est
 * cumulatif, sans longueur de fenêtre). Rendu : courbe en pane séparé +
 * segments/labels/tooltips du canal d'annotations.
 */

import { defDivergenceOscillateur } from "../utils-fabrique-divergence";
import { obvOf } from "../volume/obv";

export const obvDivergence = defDivergenceOscillateur({
  id: "obvDivergence",
  name: "Divergence OBV",
  category: "strategy",
  precision: 0,
  serieOsc: { key: "obv", name: "OBV" },
  inputsOsc: [],
  formateur: (v) => v.toFixed(0),
  oscillateur: (candles) => obvOf(candles),
});
