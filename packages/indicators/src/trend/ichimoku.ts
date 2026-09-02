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

import type { Candle, IndicatorDef } from "@axiom/types";
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

/**
 * Cœur exporté — réutilisé par les stratégies v2.3. Comportement identique à
 * l'ancien corps inline de `ichimoku.calc`. PURE.
 */
export function ichimokuOf(
  candles: Candle[],
  tenkan: number,
  kijun: number,
  senkouB: number,
  displacement: number
): {
  tenkan: Array<number | undefined>;
  kijun: Array<number | undefined>;
  spanA: Array<number | undefined>;
  spanB: Array<number | undefined>;
  chikou: Array<number | undefined>;
} {
  const highs = highOf(candles);
  const lows = lowOf(candles);
  const closes = closeOf(candles);
  const n = candles.length;

  const tenkanOut = midline(highs, lows, tenkan);
  const kijunOut = midline(highs, lows, kijun);
  const senkouBraw = midline(highs, lows, senkouB);

  // Senkou A brut = (tenkan + kijun) / 2 (avant décalage).
  const spanAraw: Array<number | undefined> = new Array(n).fill(undefined);
  for (let i = 0; i < n; i++) {
    const t = tenkanOut[i];
    const k = kijunOut[i];
    if (t !== undefined && k !== undefined) spanAraw[i] = (t + k) / 2;
  }

  // Décalage vers l'avant (+disp) pour les deux Senkou.
  const spanA: Array<number | undefined> = new Array(n).fill(undefined);
  const spanB: Array<number | undefined> = new Array(n).fill(undefined);
  for (let i = displacement; i < n; i++) {
    spanA[i] = spanAraw[i - displacement];
    spanB[i] = senkouBraw[i - displacement];
  }

  // Chikou = close projeté vers l'arrière (-disp) ; queue laissée undefined.
  const chikou: Array<number | undefined> = new Array(n).fill(undefined);
  for (let i = 0; i + displacement < n; i++) {
    chikou[i] = closes[i + displacement];
  }

  return { tenkan: tenkanOut, kijun: kijunOut, spanA, spanB, chikou };
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
    // Quantifie : le décalage sert d'index (spanAraw[i - disp], closes[i + disp]) ;
    // fractionnaire => spanA/spanB/chikou entièrement vides.
    const disp = Math.round(Number(params.displacement ?? 26));
    const r = ichimokuOf(candles, pTenkan, pKijun, pSenkou, disp);
    return {
      series: {
        tenkan: r.tenkan,
        kijun: r.kijun,
        spanA: r.spanA,
        spanB: r.spanB,
        chikou: r.chikou,
      },
    };
  },
};
