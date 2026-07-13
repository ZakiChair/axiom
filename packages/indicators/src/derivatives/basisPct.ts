/**
 * @axiom/indicators — derivatives/basisPct.ts
 *
 * Basis spot–perp en % :
 *   basis% = 100 · (mark − close) / close
 * `mark` = série aux (mark price perp Binance, alignée) ; `close` = clôture du chart.
 * Contango (basis > 0) / backwardation (basis < 0). Corrélé au funding mais calculable
 * en continu. Gratuit via markPriceKlines fapi (AuxProvider).
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf } from "../utils";

export const basisPct: IndicatorDef = {
  id: "basisPct",
  name: "Basis spot-perp %",
  category: "derivatives",
  pane: "separate",
  aux: ["mark"],
  minTimeframe: "15m",
  precision: 4,
  inputs: [],
  outputs: [{ key: "basis", name: "Basis %", style: "histogram" }],
  calc(candles, _params, ctx) {
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    const mark = ctx.aux?.mark;
    if (!mark) return { series: { basis: out } };
    const close = closeOf(candles);
    for (let i = 0; i < n; i++) {
      const m = mark[i];
      const c = close[i];
      if (m === undefined || c === undefined || !Number.isFinite(m) || !Number.isFinite(c) || c === 0) {
        continue;
      }
      out[i] = (100 * (m - c)) / c;
    }
    return { series: { basis: out } };
  },
};
