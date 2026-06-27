/**
 * @axiom/indicators — volatility/keltner.ts
 *
 * Keltner Channels (id: keltner) — canal de volatilité superposé au prix.
 *
 * Formule canonique (Linda Bradford Raschke, variante ATR) :
 *   basis = ema(close, emaLength)
 *   upper = basis + mult * atr(atrLength)
 *   lower = basis - mult * atr(atrLength)
 *   atr   = rma(trueRange, atrLength)        (lissage de Wilder, cf. utils.ts)
 *
 * Défauts : EMA(20), ATR(10), mult = 2.
 * Source : Chester Keltner / L. B. Raschke ; cf. StockCharts « Keltner Channels ».
 *
 * Alignement : `basis` est undefined tant que l'EMA n'est pas amorcée
 * (index < emaLength - 1) ; `atr` est undefined tant que la RMA n'est pas pleine
 * (index < atrLength - 1). Les bandes restent undefined si l'une des deux manque.
 */

import type {
  Candle,
  CalcContext,
  IndicatorDef,
  IndicatorResult,
} from "@axiom/types";
import { closeOf, ema, rma, trueRange } from "../utils";

export const keltner: IndicatorDef = {
  id: "keltner",
  name: "Keltner Channels",
  category: "volatility",
  pane: "overlay",
  inputs: [
    { key: "emaLength", name: "EMA Length", type: "number", default: 20, min: 1 },
    { key: "atrLength", name: "ATR Length", type: "number", default: 10, min: 1 },
    { key: "mult", name: "Multiplier", type: "number", default: 2, min: 0 },
  ],
  outputs: [
    { key: "basis", name: "Basis", style: "line" },
    { key: "upper", name: "Upper", style: "line" },
    { key: "lower", name: "Lower", style: "line" },
  ],

  calc(
    candles: Candle[],
    params: Record<string, number | boolean | string>,
    _ctx: CalcContext
  ): IndicatorResult {
    const emaLength = Number(params.emaLength);
    const atrLength = Number(params.atrLength);
    const mult = Number(params.mult);

    const close = closeOf(candles);
    const n = close.length;

    const basis = ema(close, emaLength);
    const atr = rma(trueRange(candles), atrLength);

    const upper: Array<number | undefined> = new Array(n).fill(undefined);
    const lower: Array<number | undefined> = new Array(n).fill(undefined);

    for (let i = 0; i < n; i++) {
      const b = basis[i];
      const a = atr[i];
      // Bandes définies seulement quand EMA et ATR le sont toutes deux.
      if (b === undefined || a === undefined) continue;
      const offset = mult * a;
      upper[i] = b + offset;
      lower[i] = b - offset;
    }

    return { series: { basis, upper, lower } };
  },
};
