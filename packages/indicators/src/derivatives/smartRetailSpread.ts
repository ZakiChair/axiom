/**
 * @axiom/indicators — derivatives/smartRetailSpread.ts
 *
 * Spread Smart Money vs Retail (Net Positioning Spread) :
 * Mesure l'écart de conviction nette entre les Top Traders (positions notionnelles des baleines)
 * et la foule (nombre de comptes retail) :
 *   Spread% = NPI(Top Traders) - NPI(Foule)
 *
 * Interprétation :
 *   > 0% : Les Top Traders sont plus longs que la foule (accumulation institutionnelle relative).
 *   < 0% : Les Top Traders sont plus shorts que la foule (distribution / couverture contre euphorie retail).
 *   Extrêmes (|Spread| > 30%) : Divergence majeure de positionnement, annonciatrice de squeezes.
 */

import type { IndicatorDef } from "@axiom/types";
import { sma } from "../utils";

export const smartRetailSpread: IndicatorDef = {
  id: "smartRetailSpread",
  name: "Spread Smart vs Retail (Net L/S)",
  category: "derivatives",
  pane: "separate",
  aux: ["lsAccount", "lsTopTrader"],
  minTimeframe: "1h",
  precision: 2,
  inputs: [
    { key: "smooth", name: "Lissage SMA", type: "number", default: 1, min: 1, max: 50 },
  ],
  outputs: [{ key: "spread", name: "Spread Smart - Retail %", style: "histogram" }],
  calc(candles, params, ctx) {
    const n = candles.length;
    const smooth = Math.max(1, Math.round(Number(params.smooth ?? 1)));
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    const lsAccount = ctx.aux?.lsAccount;
    const lsTopTrader = ctx.aux?.lsTopTrader;

    if (!lsAccount || !lsTopTrader) return { series: { spread: out } };

    const raw: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i < n; i++) {
      const rfoule = lsAccount[i];
      const rtop = lsTopTrader[i];
      if (
        rfoule !== undefined &&
        rtop !== undefined &&
        Number.isFinite(rfoule) &&
        Number.isFinite(rtop) &&
        rfoule > 0 &&
        rtop > 0
      ) {
        const npiFoule = ((rfoule - 1) / (rfoule + 1)) * 100;
        const npiTop = ((rtop - 1) / (rtop + 1)) * 100;
        raw.push(npiTop - npiFoule);
        indices.push(i);
      }
    }

    if (smooth <= 1) {
      for (let k = 0; k < raw.length; k++) {
        const idx = indices[k];
        const val = raw[k];
        if (idx !== undefined && val !== undefined) {
          out[idx] = val;
        }
      }
    } else {
      const smoothed = sma(raw, smooth);
      for (let k = 0; k < smoothed.length; k++) {
        const idx = indices[k];
        const val = smoothed[k];
        if (idx !== undefined && val !== undefined) {
          out[idx] = val;
        }
      }
    }

    return { series: { spread: out } };
  },
};
