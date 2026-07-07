/**
 * @axiom/indicators — trend/macd.ts
 *
 * MACD (Moving Average Convergence Divergence) — indicateur de tendance/momentum
 * affiché dans un pane séparé.
 *
 * Calcul (sur une série de prix configurable, input "source", défaut close) :
 *   macd[i]   = ema(source, fast)[i] - ema(source, slow)[i]   (undefined si l'une manque)
 *   signal    = ema appliquée aux valeurs DÉFINIES de la ligne MACD, puis ré-alignée
 *               (les `undefined` du début de la ligne MACD sont reportés)
 *   hist[i]   = macd[i] - signal[i]                          (undefined si l'une manque)
 *
 * Les positions précédant la première fenêtre pleine valent `undefined`
 * (convention commune des helpers de utils.ts).
 */

import type { IndicatorDef } from "@axiom/types";
import { ema as emaOf } from "../utils";

export const macd: IndicatorDef = {
  id: "macd",
  name: "MACD",
  category: "trend",
  pane: "separate",
  inputs: [
    { key: "fast", name: "Fast", type: "number", default: 12, min: 1 },
    { key: "slow", name: "Slow", type: "number", default: 26, min: 1 },
    { key: "signal", name: "Signal", type: "number", default: 9, min: 1 },
    {
      key: "source",
      name: "Source",
      type: "source",
      default: "close",
      options: ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"],
    },
  ],
  outputs: [
    { key: "macd", name: "MACD", style: "line" },
    { key: "signal", name: "Signal", style: "line" },
    { key: "hist", name: "Histogram", style: "histogram" },
  ],
  calc(candles, params, ctx) {
    // Paramètres garantis numériques par le contrat d'input (défauts 12/26/9).
    const fast = Number(params.fast ?? 12);
    const slow = Number(params.slow ?? 26);
    const signal = Number(params.signal ?? 9);

    const close = ctx.source;
    const n = close.length;

    const fastEma = emaOf(close, fast);
    const slowEma = emaOf(close, slow);

    // Ligne MACD : différence des deux EMA ; undefined tant que l'une manque.
    const macdLine: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const f = fastEma[i];
      const s = slowEma[i];
      if (f !== undefined && s !== undefined) macdLine[i] = f - s;
    }

    // Ligne signal : EMA des seules valeurs DÉFINIES de la ligne MACD.
    // On compacte (en mémorisant l'index d'origine), on lisse, puis on ré-aligne :
    // les `undefined` initiaux de la ligne MACD restent `undefined` dans le signal,
    // et le démarrage propre de l'EMA (signal - 1 valeurs) décale encore le signal.
    const definedIdx: number[] = [];
    const definedVals: number[] = [];
    for (let i = 0; i < n; i++) {
      const v = macdLine[i];
      if (v !== undefined) {
        definedIdx.push(i);
        definedVals.push(v);
      }
    }
    const signalCompact = emaOf(definedVals, signal);
    const signalLine: Array<number | undefined> = new Array(n).fill(undefined);
    for (let j = 0; j < definedIdx.length; j++) {
      const idx = definedIdx[j];
      if (idx === undefined) continue; // garde explicite (noUncheckedIndexedAccess)
      signalLine[idx] = signalCompact[j];
    }

    // Histogramme : MACD - signal, là où les deux valeurs existent.
    const hist: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const m = macdLine[i];
      const s = signalLine[i];
      if (m !== undefined && s !== undefined) hist[i] = m - s;
    }

    return {
      series: {
        macd: macdLine,
        signal: signalLine,
        hist,
      },
    };
  },
};
