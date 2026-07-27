/**
 * @axiom/indicators — momentum/stochDivergence.ts
 *
 * Divergences Stochastic ↔ prix (lot v2.1, via la fabrique commune). Oscillateur :
 * %K LISSÉ (SMA de `lissageK` sur le %K brut, cf. `smaOfDefined`/`stochKOf`) — le
 * stochastique « slow », standard des lectures de divergence (le %K brut est trop
 * bruité pour des pivots fractals stables). Rendu : courbe en pane séparé +
 * segments/labels/tooltips du canal d'annotations.
 */

import { defDivergenceOscillateur } from "../utils-fabrique-divergence";
import { smaOfDefined, stochKOf } from "./stochastic";

export const stochDivergence = defDivergenceOscillateur({
  id: "stochDivergence",
  name: "Stochastic Divergence",
  category: "momentum",
  precision: 2,
  serieOsc: { key: "k", name: "Stoch %K" },
  inputsOsc: [
    { key: "longueurK", name: "%K", type: "number", default: 14, min: 1 },
    { key: "lissageK", name: "Lissage %K", type: "number", default: 3, min: 1 },
  ],
  oscillateur: (candles, params) =>
    smaOfDefined(stochKOf(candles, Number(params.longueurK ?? 14)), Number(params.lissageK ?? 3)),
});
