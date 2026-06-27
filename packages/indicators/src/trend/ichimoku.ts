/**
 * @axiom/indicators — trend/ichimoku.ts
 *
 * Ichimoku Kinko Hyo (« nuage » d'Ichimoku) — superposé au prix (pane overlay).
 * Source canonique : Goichi Hosoda / StockCharts School (Ichimoku Cloud).
 *
 * Cinq lignes :
 *   tenkan (Conversion, 9)  = (plusHaut(high, 9)  + plusBas(low, 9))  / 2
 *   kijun  (Base, 26)       = (plusHaut(high, 26) + plusBas(low, 26)) / 2
 *   spanA  (Senkou A)       = (tenkan + kijun) / 2, DÉCALÉ de +displacement bougies (futur)
 *   spanB  (Senkou B, 52)   = (plusHaut(high, 52) + plusBas(low, 52)) / 2, DÉCALÉ de +displacement
 *   chikou (Lagging)        = close DÉCALÉ de -displacement bougies (passé)
 *
 * Convention de décalage alignée sur l'index des bougies :
 *   - spanA[i] / spanB[i] reçoivent la valeur calculée `displacement` bougies AVANT
 *     (projection vers l'avant : la valeur du bar i-displacement s'affiche en i).
 *   - chikou[i] reçoit close[i+displacement] (projection vers l'arrière). Les dernières
 *     `displacement` positions de chikou restent donc `undefined`.
 *
 * Les positions précédant la première fenêtre pleine valent `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";
import { highOf, lowOf, closeOf, rollingHighest, rollingLowest } from "../utils";

/** Ligne médiane (« donchian mid ») : (plusHaut + plusBas) / 2 sur `length`. */
function midline(
  highs: number[],
  lows: number[],
  length: number
): Array<number | undefined> {
  const hh = rollingHighest(highs, length);
  const ll = rollingLowest(lows, length);
  const n = highs.length;
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  for (let i = 0; i < n; i++) {
    const h = hh[i];
    const l = ll[i];
    if (h !== undefined && l !== undefined) out[i] = (h + l) / 2;
  }
  return out;
}

export const ichimoku: IndicatorDef = {
  id: "ichimoku",
  name: "Ichimoku",
  category: "trend",
  pane: "overlay",
  inputs: [
    { key: "tenkan", name: "Tenkan", type: "number", default: 9, min: 1 },
    { key: "kijun", name: "Kijun", type: "number", default: 26, min: 1 },
    { key: "senkou", name: "Senkou B", type: "number", default: 52, min: 1 },
    {
      key: "displacement",
      name: "Décalage",
      type: "number",
      default: 26,
      min: 1,
    },
  ],
  outputs: [
    { key: "tenkan", name: "Tenkan-sen", style: "line" },
    { key: "kijun", name: "Kijun-sen", style: "line" },
    { key: "spanA", name: "Senkou Span A", style: "line" },
    { key: "spanB", name: "Senkou Span B", style: "line" },
    { key: "chikou", name: "Chikou Span", style: "line" },
  ],
  calc(candles, params) {
    const pTenkan = Number(params.tenkan ?? 9);
    const pKijun = Number(params.kijun ?? 26);
    const pSenkou = Number(params.senkou ?? 52);
    const disp = Number(params.displacement ?? 26);

    const highs = highOf(candles);
    const lows = lowOf(candles);
    const closes = closeOf(candles);
    const n = candles.length;

    const tenkan = midline(highs, lows, pTenkan);
    const kijun = midline(highs, lows, pKijun);
    const senkouBraw = midline(highs, lows, pSenkou);

    // Senkou A brut = (tenkan + kijun) / 2 (avant décalage).
    const spanAraw: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const t = tenkan[i];
      const k = kijun[i];
      if (t !== undefined && k !== undefined) spanAraw[i] = (t + k) / 2;
    }

    // Décalage vers l'avant (+disp) pour les deux Senkou.
    const spanA: Array<number | undefined> = new Array(n).fill(undefined);
    const spanB: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = disp; i < n; i++) {
      spanA[i] = spanAraw[i - disp];
      spanB[i] = senkouBraw[i - disp];
    }

    // Chikou = close projeté vers l'arrière (-disp) ; queue laissée undefined.
    const chikou: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i + disp < n; i++) {
      chikou[i] = closes[i + disp];
    }

    return { series: { tenkan, kijun, spanA, spanB, chikou } };
  },
};
