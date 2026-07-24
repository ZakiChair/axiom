/**
 * @axiom/indicators — orderflow/cvd.ts
 *
 * CVD (Cumulative Volume Delta) par bougie — somme cumulée de
 * (buyVolume − sellVolume). Exige les champs taker buy/sell sur la Candle
 * (Binance spot/perp, etc.). Sans ces champs → delta 0 pour la barre.
 *
 * Paramètre `smooth` : SMA optionnelle du CVD (signal de tendance du delta).
 * Edge : divergence prix/CVD ; lire pentes, pas niveaux absolus (offset d'ancre).
 */

import type { Candle, IndicatorDef } from "@axiom/types";
import { sma } from "../utils";

/**
 * Cœur du CVD : somme cumulée de (buyVolume − sellVolume) par bougie, extrait
 * pour être réutilisé par la def `cvdDivergence` (Task 3) comme oscillateur.
 * Comportement identique au corps inline de `cvd.calc` : une bougie sans champs
 * taker buy/sell laisse le cumul inchangé (delta 0) → série toujours finie. Une
 * source SANS aucun buy/sell produit donc une série plate à 0 : plate = aucun
 * pivot fractal strict → aucune divergence → aucun point (dégradation propre). PURE.
 */
export function cvdOf(candles: Candle[]): number[] {
  const n = candles.length;
  const raw: number[] = new Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const c = candles[i];
    if (c !== undefined) {
      const buy = c.buyVolume;
      const sell = c.sellVolume;
      if (buy !== undefined && sell !== undefined && Number.isFinite(buy) && Number.isFinite(sell)) {
        acc += buy - sell;
      }
    }
    raw[i] = acc;
  }
  return raw;
}

export const cvd: IndicatorDef = {
  id: "cvd",
  name: "CVD (Volume Delta cumulé)",
  category: "orderflow",
  pane: "separate",
  inputs: [
    {
      key: "smooth",
      name: "Lissage SMA",
      type: "number",
      default: 1,
      min: 1,
      max: 200,
    },
  ],
  outputs: [
    { key: "cvd", name: "CVD", style: "line" },
    { key: "signal", name: "CVD lissé", style: "line" },
  ],
  precision: 0,
  calc(candles, params) {
    const smooth = Math.max(1, Math.floor(Number(params.smooth) || 1));
    const raw = cvdOf(candles);
    const cvdOut: Array<number | undefined> = raw.map((v) => v);
    const signal =
      smooth <= 1
        ? cvdOut
        : sma(raw, smooth);
    return { series: { cvd: cvdOut, signal } };
  },
};
