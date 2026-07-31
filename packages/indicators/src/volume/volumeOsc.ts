/**
 * @axiom/indicators — volume/volumeOsc.ts
 *
 * Volume Oscillator (PVO sur volume) — écart relatif entre deux EMA de volume.
 * Source : TradingView "Volume Oscillator".
 *
 * Formule :
 *   osc[i] = 100 * (EMA(volume, short)[i] - EMA(volume, long)[i]) / EMA(volume, long)[i]
 *   (short=5, long=10 par défaut)
 *
 * L'EMA longue impose `long - 1` positions `undefined` en tête ; garde
 * supplémentaire si EMA(long) == 0 (division impossible).
 */

import type { IndicatorDef } from "@axiom/types";
import { volOf, ema } from "../utils";

export const volumeOsc: IndicatorDef = {
  id: "volumeOsc",
  name: "Oscillateur de volume",
  category: "volume",
  pane: "separate",
  inputs: [
    { key: "short", name: "Court", type: "number", default: 5, min: 1 },
    { key: "long", name: "Long", type: "number", default: 10, min: 1 },
  ],
  outputs: [{ key: "volumeOsc", name: "Volume Osc", style: "line" }],
  calc(candles, params) {
    const short = Number(params.short ?? 5);
    const long = Number(params.long ?? 10);
    const vol = volOf(candles);
    const n = candles.length;

    const emaShort = ema(vol, short);
    const emaLong = ema(vol, long);

    const out: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const s = emaShort[i];
      const l = emaLong[i];
      if (s === undefined || l === undefined || l === 0) continue;
      out[i] = (100 * (s - l)) / l;
    }
    return { series: { volumeOsc: out } };
  },
};
