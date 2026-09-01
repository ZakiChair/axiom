/**
 * @axiom/indicators — momentum/stochRsi.ts
 *
 * Stochastic RSI — oscillateur stochastique appliqué au RSI (et non au prix).
 * Source : Chande & Kroll / Investopedia / pandas-ta `stochrsi`.
 *
 * Paramètres par défaut : 14 / 14 / 3 / 3.
 * Formule :
 *   r = RSI(close, rsiLength)                       (lissage de Wilder)
 *   raw[i] = 100 * (r[i] - LL(r, stochLength)[i]) / (HH(r, stochLength)[i] - LL[i])
 *   %K[i]  = SMA(raw, kSmooth)[i]
 *   %D[i]  = SMA(%K,  dSmooth)[i]
 *
 * Borne théorique : [0, 100]. Si HH == LL sur la fenêtre RSI -> `raw` `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf, rma } from "../utils";

/** RSI de Wilder sur une série de valeurs quelconque (aligné, undefined avant la fenêtre). */
function rsiOfValues(values: number[], length: number): Array<number | undefined> {
  const n = values.length;
  const out: Array<number | undefined> = new Array(n).fill(undefined);

  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < n; i++) {
    const cur = values[i];
    const prev = values[i - 1];
    if (cur === undefined || prev === undefined) {
      gains.push(0);
      losses.push(0);
      continue;
    }
    const delta = cur - prev;
    gains.push(delta > 0 ? delta : 0);
    losses.push(delta < 0 ? -delta : 0);
  }

  const avgGain = rma(gains, length);
  const avgLoss = rma(losses, length);
  for (let j = 0; j < gains.length; j++) {
    const g = avgGain[j];
    const l = avgLoss[j];
    if (g === undefined || l === undefined) continue;
    out[j + 1] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

/** SMA tolérante aux `undefined` : valeur produite seulement si la fenêtre est pleine. */
function smaOfDefined(
  values: Array<number | undefined>,
  length: number
): Array<number | undefined> {
  length = Math.round(length); // fenêtre entière obligatoire (voir sma / kama / fisher)
  const n = values.length;
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  if (length <= 0) return out;
  for (let i = length - 1; i < n; i++) {
    let sum = 0;
    let ok = true;
    for (let j = i - length + 1; j <= i; j++) {
      const v = values[j];
      if (v === undefined) {
        ok = false;
        break;
      }
      sum += v;
    }
    if (ok) out[i] = sum / length;
  }
  return out;
}

export const stochRsi: IndicatorDef = {
  id: "stochRsi",
  name: "RSI stochastique",
  category: "momentum",
  pane: "separate",
  inputs: [
    { key: "rsiLength", name: "RSI", type: "number", default: 14, min: 1 },
    { key: "stochLength", name: "Stoch", type: "number", default: 14, min: 1 },
    { key: "kSmooth", name: "%K", type: "number", default: 3, min: 1 },
    { key: "dSmooth", name: "%D", type: "number", default: 3, min: 1 },
  ],
  outputs: [
    { key: "k", name: "%K", style: "line" },
    { key: "d", name: "%D", style: "line" },
  ],

  calc(candles, params) {
    const rsiLength = Number(params.rsiLength ?? 14);
    // Quantifie : boucle `i = stochLength - 1` fractionnaire n'atteint aucun index entier.
    const stochLength = Math.round(Number(params.stochLength ?? 14));
    const kSmooth = Number(params.kSmooth ?? 3);
    const dSmooth = Number(params.dSmooth ?? 3);

    const closes = closeOf(candles);
    const n = closes.length;
    const r = rsiOfValues(closes, rsiLength);

    // Stochastique brut du RSI : produit seulement si la fenêtre RSI est pleine.
    const raw: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = stochLength - 1; i < n; i++) {
      let hi = -Infinity;
      let lo = Infinity;
      let ok = true;
      for (let j = i - stochLength + 1; j <= i; j++) {
        const v = r[j];
        if (v === undefined) {
          ok = false;
          break;
        }
        if (v > hi) hi = v;
        if (v < lo) lo = v;
      }
      if (!ok) continue;
      const range = hi - lo;
      if (range === 0) continue; // RSI plat sur la fenêtre : stoch non défini.
      const cur = r[i];
      if (cur === undefined) continue;
      raw[i] = (100 * (cur - lo)) / range;
    }

    const k = smaOfDefined(raw, kSmooth);
    const d = smaOfDefined(k, dSmooth);

    return { series: { k, d } };
  },
};
