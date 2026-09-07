/**
 * @axiom/indicators — derivatives/netPositioningTopTrader.ts
 *
 * Positionnement net des Top Traders (Binance futures) :
 * Transforme le ratio long/short brut des positions des plus gros comptes (lsTopTrader)
 * en oscillateur centré sur 0 et borné en [-100%, +100%] :
 *   net% = ((ratio - 1) / (ratio + 1)) * 100
 *
 * Représente la conviction directionnelle notionnelle de l'argent institutionnel ("smart money").
 */

import type { IndicatorDef } from "@axiom/types";
import { sma } from "../utils";

export const netPositioningTopTrader: IndicatorDef = {
  id: "netPositioningTopTrader",
  name: "Positionnement net top traders (NPI %)",
  category: "derivatives",
  pane: "separate",
  aux: ["lsTopTrader"],
  minTimeframe: "1h",
  precision: 2,
  inputs: [
    { key: "smooth", name: "Lissage SMA", type: "number", default: 1, min: 1, max: 50 },
  ],
  outputs: [{ key: "npiTop", name: "Net top %", style: "histogram" }],
  calc(candles, params, ctx) {
    const n = candles.length;
    const smooth = Math.max(1, Math.round(Number(params.smooth ?? 1)));
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    const series = ctx.aux?.lsTopTrader;

    if (!series) return { series: { npiTop: out } };

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

    return { series: { npiTop: out } };
  },
};
