/**
 * @axiom/indicators — volatility/vhf.ts
 *
 * VHF (Vertical Horizontal Filter) — distingue marché EN TENDANCE d'un marché EN RANGE :
 *   VHF[i] = ( max(close, n) − min(close, n) ) / Σ|close[j] − close[j−1]| sur n
 * Numérateur = amplitude nette (mouvement directionnel) ; dénominateur = somme des
 * mouvements bruts. VHF ÉLEVÉ = forte tendance (le déplacement net domine le bruit) ;
 * VHF BAS = range/consolidation. Sert à filtrer : suiveurs de tendance si VHF haut.
 *
 * Défaut length = 28. Réutilise rollingHighest/Lowest + rollingSum (utils).
 */

import type { Candle, CalcContext, IndicatorDef, IndicatorResult } from "@axiom/types";
import { closeOf, rollingHighest, rollingLowest, rollingSum } from "../utils";

export const vhf: IndicatorDef = {
  id: "vhf",
  name: "Vertical Horizontal Filter",
  category: "volatility",
  pane: "separate",
  inputs: [{ key: "length", name: "Longueur", type: "number", default: 28, min: 2 }],
  outputs: [{ key: "vhf", name: "VHF", style: "line" }],
  calc(candles: Candle[], params: Record<string, number | boolean | string>, _ctx: CalcContext): IndicatorResult {
    const length = Number(params.length);
    const n = candles.length;
    const close = closeOf(candles);

    const hh = rollingHighest(close, length);
    const ll = rollingLowest(close, length);
    // |Δclose| par barre (0 au 1er point), puis somme roulante sur `length`.
    const absChange = new Array<number>(n).fill(0);
    for (let i = 1; i < n; i++) {
      const c = close[i];
      const p = close[i - 1];
      if (c !== undefined && p !== undefined) absChange[i] = Math.abs(c - p);
    }
    const sommeMouv = rollingSum(absChange, length);

    const out: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const h = hh[i];
      const l = ll[i];
      const s = sommeMouv[i];
      if (h === undefined || l === undefined || s === undefined || s === 0) continue;
      out[i] = (h - l) / s;
    }
    return { series: { vhf: out } };
  },
};
