/**
 * @axiom/indicators — momentum/rsiDivergence.ts
 *
 * Divergences RSI ↔ prix, v2 (lot v2.1) : pane SÉPARÉ portant la courbe RSI,
 * segments pivot→pivot sur le RSI (cible "pane") ET sur le prix (cible "prix",
 * rendus en overlays par l'app), labels « Div ▲/▼ » (régulières), pointillés
 * pour les cachées, tooltips. Détection inchangée (detecterDivergences via le
 * moteur commun) ; l'oscillateur reste le RSI de Wilder (rsiOf) sur la source
 * configurée. Remplace le rendu « 4 sorties points » de la v1 (limite consignée :
 * pas de rayon, cachées indistinguables — levée par le canal d'annotations).
 */

import { defDivergenceOscillateur } from "../utils-fabrique-divergence";
import { rsiOf } from "./rsi";

export const rsiDivergence = defDivergenceOscillateur({
  id: "rsiDivergence",
  name: "RSI Divergence",
  category: "momentum",
  precision: 2,
  serieOsc: { key: "rsi", name: "RSI" },
  inputsOsc: [
    { key: "length", name: "Longueur RSI", type: "number", default: 14, min: 1 },
    {
      key: "source",
      name: "Source",
      type: "source",
      default: "close",
      options: ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"],
    },
  ],
  oscillateur: (_candles, params, ctx) => rsiOf(ctx.source, Number(params.length ?? 14)),
});
