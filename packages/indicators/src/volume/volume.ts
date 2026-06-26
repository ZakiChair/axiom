/**
 * @axiom/indicators — volume/volume.ts
 *
 * Indicateur Volume : passthrough simple du volume (en base) de chaque bougie,
 * rendu sous forme d'histogramme dans un pane séparé.
 *
 * NB : contrairement aux moyennes mobiles, le Volume n'a AUCUNE fenêtre de calcul
 * ni période d'amorçage — chaque bougie a directement une valeur. Il n'existe donc
 * pas de positions `undefined` en début de série pour cet indicateur. Une valeur
 * ne devient `undefined` que si la bougie correspondante est manquante.
 */

import type { Candle, CalcContext, IndicatorDef, IndicatorResult } from "@axiom/types";

export const volume: IndicatorDef = {
  id: "volume",
  name: "Volume",
  category: "volume",
  pane: "separate",
  inputs: [],
  outputs: [{ key: "volume", name: "Volume", style: "histogram" }],
  calc(
    candles: Candle[],
    _params: Record<string, number | boolean | string>,
    _ctx: CalcContext
  ): IndicatorResult {
    // Passthrough : on extrait le volume de chaque bougie, aligné index par index.
    // `noUncheckedIndexedAccess` actif — une bougie absente donne `undefined`.
    const out: Array<number | undefined> = candles.map((c) => c?.volume);
    return { series: { volume: out } };
  },
};
