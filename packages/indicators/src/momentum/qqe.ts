/**
 * @axiom/indicators — momentum/qqe.ts
 *
 * QQE (Quantitative Qualitative Estimation) — surcouche du RSI :
 *   RSI → EMA (SF) → bande ATR-of-RSI × facteur (≈ 4.236 fib)
 * Sorties : ligne QQE (RSI lissé) + bandes trail long/short.
 * Oscillateur 0–100, pane séparé. Gratuit, OHLCV pur.
 */

import type { IndicatorDef } from "@axiom/types";
import { ema, rma } from "../utils";

/** RSI Wilder sur une série source (même convention que rsi.ts). */
function rsiOf(source: number[], length: number): Array<number | undefined> {
  const n = source.length;
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < n; i++) {
    const cur = source[i];
    const prev = source[i - 1];
    if (cur === undefined || prev === undefined) {
      gains.push(0);
      losses.push(0);
      continue;
    }
    const d = cur - prev;
    gains.push(d > 0 ? d : 0);
    losses.push(d < 0 ? -d : 0);
  }
  // gains[j] aligne sur bougie j+1
  const avgGain = rma(gains, length);
  const avgLoss = rma(losses, length);
  for (let i = 0; i < avgGain.length; i++) {
    const g = avgGain[i];
    const l = avgLoss[i];
    if (g === undefined || l === undefined) continue;
    const bar = i + 1;
    if (l === 0) {
      out[bar] = 100;
      continue;
    }
    const rs = g / l;
    out[bar] = 100 - 100 / (1 + rs);
  }
  return out;
}

export const qqe: IndicatorDef = {
  id: "qqe",
  name: "QQE",
  category: "momentum",
  pane: "separate",
  precision: 2,
  inputs: [
    { key: "rsiLength", name: "RSI", type: "number", default: 14, min: 2, max: 100 },
    { key: "sf", name: "SF (EMA RSI)", type: "number", default: 5, min: 1, max: 50 },
    { key: "factor", name: "Facteur QQE", type: "number", default: 4.236, min: 1, max: 10 },
    {
      key: "source",
      name: "Source",
      type: "source",
      default: "close",
      options: ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"],
    },
  ],
  outputs: [
    { key: "qqe", name: "QQE", style: "line" },
    { key: "fast", name: "Bande rapide", style: "line" },
    { key: "slow", name: "Bande lente", style: "line" },
  ],
  calc(candles, params, ctx) {
    const rsiLength = Math.max(2, Math.floor(Number(params.rsiLength) || 14));
    const sf = Math.max(1, Math.floor(Number(params.sf) || 5));
    const factor = Number(params.factor) || 4.236;
    const n = candles.length;
    const qqeOut: Array<number | undefined> = new Array(n).fill(undefined);
    const fast: Array<number | undefined> = new Array(n).fill(undefined);
    const slow: Array<number | undefined> = new Array(n).fill(undefined);

    const rsiSeries = rsiOf(ctx.source, rsiLength);
    // EMA du RSI : on travaille sur une série dense (0 hors zone définie).
    const rsiDense = rsiSeries.map((v) => (v === undefined ? Number.NaN : v));
    // Remplace NaN par dernier connu pour l'EMA (évite de casser le lissage).
    let lastRsi = 50;
    for (let i = 0; i < rsiDense.length; i++) {
      if (Number.isFinite(rsiDense[i]!)) lastRsi = rsiDense[i]!;
      else rsiDense[i] = lastRsi;
    }
    const rsiMa = ema(rsiDense, sf);

    // |Δ RSI_MA| → RMA (Wilder period ≈ 2*rsiLength−1)
    const wilders = Math.max(1, 2 * rsiLength - 1);
    const atrRsiRaw: number[] = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
      const a = rsiMa[i];
      const b = rsiMa[i - 1];
      if (a === undefined || b === undefined) continue;
      atrRsiRaw[i] = Math.abs(a - b);
    }
    const maAtrRsi = rma(atrRsiRaw, wilders);

    let longBand = 0;
    let shortBand = 100;
    let trend = 0; // 1 long, -1 short

    for (let i = 0; i < n; i++) {
      const rm = rsiMa[i];
      const dar = maAtrRsi[i];
      if (rm === undefined || dar === undefined) continue;
      if (rsiSeries[i] === undefined) continue;

      const newLong = rm - dar * factor;
      const newShort = rm + dar * factor;

      // Trailing bands (logique QQE classique).
      if (rm > longBand && rsiMa[i - 1] !== undefined && rsiMa[i - 1]! > longBand) {
        longBand = Math.max(longBand, newLong);
      } else {
        longBand = newLong;
      }
      if (rm < shortBand && rsiMa[i - 1] !== undefined && rsiMa[i - 1]! < shortBand) {
        shortBand = Math.min(shortBand, newShort);
      } else {
        shortBand = newShort;
      }

      // Direction : croisement des bandes.
      if (rm > shortBand && trend <= 0) trend = 1;
      else if (rm < longBand && trend >= 0) trend = -1;

      qqeOut[i] = rm;
      fast[i] = trend === 1 ? longBand : shortBand;
      slow[i] = trend === 1 ? shortBand : longBand;
    }

    return { series: { qqe: qqeOut, fast, slow } };
  },
};
