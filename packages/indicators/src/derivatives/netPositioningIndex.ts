/**
 * @axiom/indicators — derivatives/netPositioningIndex.ts
 *
 * Positionnement net de la foule (Binance futures) :
 * Transforme le ratio long/short brut des comptes (lsAccount) en oscillateur
 * centré sur 0 et borné en [-100%, +100%] :
 *   net% = ((ratio - 1) / (ratio + 1)) * 100
 *
 * Interprétation :
 *   0% = équilibre parfait (50% longs, 50% shorts)
 *   > 0% = net long (ex. ratio 2.0 -> +33.33%, ratio 3.0 -> +50%)
 *   < 0% = net short (ex. ratio 0.5 -> -33.33%, ratio 0.333 -> -50%)
 *
 * Permet une lecture symétrique et l'application d'un lissage optionnel.
 */

import type { IndicatorDef } from "@axiom/types";
import { sma } from "../utils";

export const netPositioningIndex: IndicatorDef = {
  id: "netPositioningIndex",
  name: "Positionnement net foule (NPI %)",
  category: "derivatives",
  pane: "separate",
  aux: ["lsAccount"],
  minTimeframe: "1h",
  precision: 2,
  inputs: [
    { key: "smooth", name: "Lissage SMA", type: "number", default: 1, min: 1, max: 50 },
  ],
  outputs: [{ key: "npi", name: "Net foule %", style: "histogram" }],
  calc(candles, params, ctx) {
    const n = candles.length;
    const smooth = Math.max(1, Math.round(Number(params.smooth ?? 1)));
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    const series = ctx.aux?.lsAccount;

    if (!series) return { series: { npi: out } };

    const raw: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i < n; i++) {
      const r = series[i];
      if (r !== undefined && Number.isFinite(r) && r > 0) {
        const net = ((r - 1) / (r + 1)) * 100;
        raw.push(net);
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

    return { series: { npi: out } };
  },
};
