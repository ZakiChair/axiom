/**
 * @axiom/indicators — orderflow/takerNetPct.ts
 *
 * Taker Net Flow % — Pression nette des agresseurs normalisée en [-100%, +100%] :
 *   net% = ((buyVolume - sellVolume) / (buyVolume + sellVolume)) * 100
 *
 * Sans volumes split (buy/sell) réels et valides, la valeur reste indéfinie :
 * la couleur de la bougie ne constitue pas une mesure du flux taker.
 *
 * Inclut une ligne de signal EMA pour dégager la tendance de flux net agresseur.
 * L'EMA porte sur les observations valides : les trous ne créent pas de zéro et
 * ne font pas avancer le lissage, même si deux observations sont éloignées dans le temps.
 */

import type { IndicatorDef } from "@axiom/types";
import { ema } from "../utils";

export const takerNetPct: IndicatorDef = {
  id: "takerNetPct",
  name: "Taker Net Flow %",
  category: "orderflow",
  pane: "separate",
  inputs: [
    { key: "emaLength", name: "Signal EMA", type: "number", default: 9, min: 1, max: 100 },
  ],
  outputs: [
    { key: "net", name: "Net Flow %", style: "histogram" },
    { key: "signal", name: "Signal EMA", style: "line" },
  ],
  precision: 1,
  calc(candles, params) {
    const n = candles.length;
    const emaLength = Math.max(1, Math.round(Number(params.emaLength ?? 9)));
    const netOut: Array<number | undefined> = new Array(n).fill(undefined);
    const netCompacts: number[] = [];
    const indexDefinis: number[] = [];

    for (let i = 0; i < n; i++) {
      const c = candles[i];
      if (c === undefined) continue;
      const buy = c.buyVolume;
      const sell = c.sellVolume;

      if (
        buy === undefined ||
        sell === undefined ||
        !Number.isFinite(buy) ||
        !Number.isFinite(sell) ||
        buy < 0 ||
        sell < 0
      ) continue;
      const total = buy + sell;
      if (total <= 0) continue;

      const val = ((buy - sell) / total) * 100;
      netOut[i] = val;
      netCompacts.push(val);
      indexDefinis.push(i);
    }

    const signalCompact = ema(netCompacts, emaLength);
    const signalSeries: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < indexDefinis.length; i++) {
      const indexOriginal = indexDefinis[i];
      const valeur = signalCompact[i];
      if (indexOriginal !== undefined && valeur !== undefined) signalSeries[indexOriginal] = valeur;
    }

    return {
      series: {
        net: netOut,
        signal: signalSeries,
      },
    };
  },
};
