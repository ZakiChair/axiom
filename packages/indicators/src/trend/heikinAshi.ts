/**
 * @axiom/indicators — trend/heikinAshi.ts
 *
 * Heikin Ashi (moyennes de bougies) en séries overlay :
 *   haClose = (O+H+L+C)/4
 *   haOpen  = (haOpen[i-1] + haClose[i-1]) / 2
 *   haHigh  = max(H, haOpen, haClose)
 *   haLow   = min(L, haOpen, haClose)
 * Lignes HA open/close pour lire la tendance lissée sans changer le moteur de bougies.
 */

import type { IndicatorDef } from "@axiom/types";

export const heikinAshi: IndicatorDef = {
  id: "heikinAshi",
  name: "Heikin Ashi (lignes)",
  category: "trend",
  pane: "overlay",
  inputs: [],
  outputs: [
    { key: "haOpen", name: "HA Open", style: "line" },
    { key: "haClose", name: "HA Close", style: "line" },
    { key: "haHigh", name: "HA High", style: "line" },
    { key: "haLow", name: "HA Low", style: "line" },
  ],
  calc(candles) {
    const n = candles.length;
    const haOpen: Array<number | undefined> = new Array(n).fill(undefined);
    const haClose: Array<number | undefined> = new Array(n).fill(undefined);
    const haHigh: Array<number | undefined> = new Array(n).fill(undefined);
    const haLow: Array<number | undefined> = new Array(n).fill(undefined);

    for (let i = 0; i < n; i++) {
      const c = candles[i];
      if (c === undefined) continue;
      const hc = (c.open + c.high + c.low + c.close) / 4;
      let ho: number;
      if (i === 0 || haOpen[i - 1] === undefined || haClose[i - 1] === undefined) {
        ho = (c.open + c.close) / 2;
      } else {
        ho = (haOpen[i - 1]! + haClose[i - 1]!) / 2;
      }
      haClose[i] = hc;
      haOpen[i] = ho;
      haHigh[i] = Math.max(c.high, ho, hc);
      haLow[i] = Math.min(c.low, ho, hc);
    }
    return { series: { haOpen, haClose, haHigh, haLow } };
  },
};
