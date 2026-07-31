/**
 * @axiom/indicators — orderflow/netVolume.ts
 *
 * Volume net par bougie via la direction de clôture (tick rule simplifiée) :
 *   +volume si close ≥ open, −volume sinon.
 * Fallback orderflow quand buy/sell absents (Twelve Data, agrégats).
 * Cumul optionnel (mode « OBV signé sur range », pas strict OBV).
 */

import type { IndicatorDef } from "@axiom/types";

export const netVolume: IndicatorDef = {
  id: "netVolume",
  name: "Volume net (tick rule)",
  category: "orderflow",
  pane: "separate",
  inputs: [
    {
      key: "cumulative",
      name: "Cumulatif",
      type: "boolean",
      default: false,
    },
  ],
  outputs: [{ key: "net", name: "Net", style: "histogram" }],
  precision: 0,
  calc(candles, params) {
    const cumulative = Boolean(params.cumulative);
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      if (c === undefined) continue;
      const signed = (c.close >= c.open ? 1 : -1) * c.volume;
      if (cumulative) {
        acc += signed;
        out[i] = acc;
      } else {
        out[i] = signed;
      }
    }
    return { series: { net: out } };
  },
};
