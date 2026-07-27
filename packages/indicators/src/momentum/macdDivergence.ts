/**
 * @axiom/indicators — momentum/macdDivergence.ts
 *
 * Divergences MACD ↔ prix (lot v2.1, via la fabrique commune). L'oscillateur est
 * au choix la LIGNE MACD (défaut — la lecture canonique en divergence) ou
 * l'HISTOGRAMME (macd − signal), sur la source configurée. Rendu : courbe en pane
 * séparé + segments/labels/tooltips du canal d'annotations.
 */

import { defDivergenceOscillateur } from "../utils-fabrique-divergence";
import { macdOf } from "../trend/macd";

export const macdDivergence = defDivergenceOscillateur({
  id: "macdDivergence",
  name: "MACD Divergence",
  category: "momentum",
  precision: 4,
  serieOsc: { key: "osc", name: "MACD" },
  inputsOsc: [
    { key: "fast", name: "Fast", type: "number", default: 12, min: 1 },
    { key: "slow", name: "Slow", type: "number", default: 26, min: 1 },
    { key: "signal", name: "Signal", type: "number", default: 9, min: 1 },
    {
      key: "source", name: "Source", type: "source", default: "close",
      options: ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"],
    },
    { key: "oscSource", name: "Oscillateur", type: "select", default: "ligne", options: ["ligne", "histogramme"] },
  ],
  oscillateur: (_candles, params, ctx) => {
    const r = macdOf(ctx.source, Number(params.fast ?? 12), Number(params.slow ?? 26), Number(params.signal ?? 9));
    return params.oscSource === "histogramme" ? r.hist : r.macd;
  },
});
