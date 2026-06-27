/**
 * @axiom/indicators — volatility/chaikinVol.ts
 *
 * Chaikin Volatility (id: chaikinVol) — variation de l'amplitude lissée, %.
 *
 * Formule canonique (Marc Chaikin) :
 *   hl    = high - low                          (amplitude de la bougie)
 *   m     = ema(hl, emaLength)                  (lissage de l'amplitude)
 *   chaik = (m[i] - m[i - rocLength]) / m[i - rocLength] * 100   (ROC sur rocLength)
 *
 * Défauts : emaLength = 10, rocLength = 10.
 * Source : Marc Chaikin ; cf. Metastock « Chaikin's Volatility ».
 *
 * Alignement : l'EMA est amorcée à l'index `emaLength - 1` ; le ROC nécessite en
 * plus `rocLength` valeurs antérieures ; première valeur à l'index
 * `emaLength - 1 + rocLength`.
 */

import type {
  Candle,
  CalcContext,
  IndicatorDef,
  IndicatorResult,
} from "@axiom/types";
import { ema, highOf, lowOf } from "../utils";

export const chaikinVol: IndicatorDef = {
  id: "chaikinVol",
  name: "Chaikin Volatility",
  category: "volatility",
  pane: "separate",
  inputs: [
    { key: "emaLength", name: "EMA Length", type: "number", default: 10, min: 1 },
    { key: "rocLength", name: "ROC Length", type: "number", default: 10, min: 1 },
  ],
  outputs: [{ key: "chaikinVol", name: "Chaikin Vol %", style: "line" }],

  calc(
    candles: Candle[],
    params: Record<string, number | boolean | string>,
    _ctx: CalcContext
  ): IndicatorResult {
    const emaLength = Number(params.emaLength);
    const rocLength = Number(params.rocLength);

    const highs = highOf(candles);
    const lows = lowOf(candles);
    const n = candles.length;

    // Amplitude high - low par bougie.
    const hl: number[] = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const h = highs[i];
      const l = lows[i];
      if (h === undefined || l === undefined) continue;
      hl[i] = h - l;
    }

    const m = ema(hl, emaLength);

    const out: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = rocLength; i < n; i++) {
      const cur = m[i];
      const past = m[i - rocLength];
      // ROC indéfini si une borne manque ou si le dénominateur est nul.
      if (cur === undefined || past === undefined || past === 0) continue;
      out[i] = ((cur - past) / past) * 100;
    }

    return { series: { chaikinVol: out } };
  },
};
