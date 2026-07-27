/**
 * @axiom/indicators — utils-fabrique-divergence.ts
 *
 * Fabrique de defs « divergence d'oscillateur » : à partir d'une fonction
 * oscillateur pure, produit un IndicatorDef complet à pane séparé — courbe de
 * l'oscillateur + annotations (segments prix/pane, labels, tooltips) via le
 * moteur commun construireAnnotationsDivergence. Chaque def concret (RSI, MACD,
 * Stoch, OBV, MFI, CVD) tient ainsi en ~25 lignes de spec déclarative.
 */

import type {
  Candle,
  CalcContext,
  IndicatorCategory,
  IndicatorDef,
  IndicatorInput,
} from "@axiom/types";
import { highOf, lowOf } from "./utils";
import { construireAnnotationsDivergence } from "./utils-annotations";

export interface SpecDivergenceOscillateur {
  id: string;
  name: string;
  category: IndicatorCategory;
  /** Inputs propres à l'oscillateur, placés AVANT les inputs communs de pivot. */
  inputsOsc: IndicatorInput[];
  /** Clé + libellé de la série de sortie (la courbe de l'oscillateur). */
  serieOsc: { key: string; name: string };
  precision?: number;
  /** Formatage des valeurs dans les tooltips (déf. toFixed(2)). */
  formateur?: (v: number) => string;
  oscillateur: (
    candles: Candle[],
    params: Record<string, number | boolean | string>,
    ctx: CalcContext
  ) => Array<number | undefined>;
}

/** Inputs communs de détection de pivots/divergences (mêmes défauts que rsiDivergence v1). */
const INPUTS_COMMUNS: IndicatorInput[] = [
  { key: "gauche", name: "Pivot gauche", type: "number", default: 5, min: 1 },
  { key: "droite", name: "Pivot droite", type: "number", default: 5, min: 1 },
  { key: "maxEcart", name: "Écart max (barres)", type: "number", default: 60, min: 5, max: 300 },
  { key: "cachees", name: "Divergences cachées", type: "boolean", default: true },
];

export function defDivergenceOscillateur(spec: SpecDivergenceOscillateur): IndicatorDef {
  const def: IndicatorDef = {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    pane: "separate",
    inputs: [...spec.inputsOsc, ...INPUTS_COMMUNS],
    outputs: [{ key: spec.serieOsc.key, name: spec.serieOsc.name, style: "line" }],
    calc(candles, params, ctx) {
      const oscSerie = spec.oscillateur(candles, params, ctx);
      const series = { [spec.serieOsc.key]: oscSerie };
      const annotations = construireAnnotationsDivergence(highOf(candles), lowOf(candles), oscSerie, {
        gauche: Number(params.gauche ?? 5),
        droite: Number(params.droite ?? 5),
        maxEcart: Number(params.maxEcart ?? 60),
        cachees: params.cachees !== false,
        nomOsc: spec.serieOsc.name,
        ...(spec.formateur !== undefined ? { formateur: spec.formateur } : {}),
      });
      return Object.keys(annotations).length > 0 ? { series, annotations } : { series };
    },
  };
  if (spec.precision !== undefined) def.precision = spec.precision;
  return def;
}
