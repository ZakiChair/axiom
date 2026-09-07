/**
 * @axiom/indicators — derivatives/squeezePressureIndex.ts
 *
 * Squeeze Pressure Index (SPI) — Mesure la tension d'un squeeze imminent en croisant
 * l'extrême de funding (Z-score), l'expansion éventuelle d'Open Interest et la compression
 * de volatilité (ATR%).
 *
 * Formule :
 *   Z = Z-Score(funding, window)
 *   ATR% = (ATR(14) / close) * 100
 *   FacteurOI = 1 + clamp(ΔOI% / 10, 0, 2)  (si OI disponible)
 *   SPI = (Z * FacteurOI) / max(0.5, ATR%)
 *
 * Interprétation :
 *   SPI > +2.0 : Risque élevé de Long Squeeze (foule gavée de longs à coût élevé + vol comprimée)
 *   SPI < -2.0 : Risque élevé de Short Squeeze (shorts piégés payant cher + carburant haussier)
 */

import type { IndicatorDef } from "@axiom/types";
import { rma, stdev } from "../utils";

export const squeezePressureIndex: IndicatorDef = {
  id: "squeezePressureIndex",
  name: "Squeeze Pressure Index (SPI)",
  category: "derivatives",
  pane: "separate",
  aux: ["funding", "oi"],
  minTimeframe: "1h",
  precision: 2,
  inputs: [
    { key: "window", name: "Fenêtre Funding Z", type: "number", default: 30, min: 10, max: 200 },
    { key: "atrPeriod", name: "Période ATR", type: "number", default: 14, min: 2, max: 50 },
  ],
  outputs: [
    { key: "spi", name: "SPI", style: "histogram" },
    { key: "seuilHaut", name: "Alerte Long Squeeze (+2)", style: "line" },
    { key: "seuilBas", name: "Alerte Short Squeeze (-2)", style: "line" },
  ],
  calc(candles, params, ctx) {
    const n = candles.length;
    const window = Math.round(Number(params.window ?? 30));
    const atrPeriod = Math.round(Number(params.atrPeriod ?? 14));

    const spiOut: Array<number | undefined> = new Array(n).fill(undefined);
    const seuilHaut: Array<number | undefined> = new Array(n).fill(2);
    const seuilBas: Array<number | undefined> = new Array(n).fill(-2);

    const funding = ctx.aux?.funding;
    if (!funding || window <= 0 || n === 0) {
      return { series: { spi: spiOut, seuilHaut, seuilBas } };
    }

    const oi = ctx.aux?.oi;

    // Calcul ATR
    const tr: number[] = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      if (c === undefined) continue;
      const prev = candles[i - 1];
      if (prev === undefined) {
        tr[i] = c.high - c.low;
      } else {
        tr[i] = Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
      }
    }
    const atrValues = rma(tr, atrPeriod);

    for (let i = 0; i < n; i++) {
      const currentFunding = funding[i];
      const candle = candles[i];
      const currentAtr = atrValues[i];

      if (currentFunding === undefined || candle === undefined || candle.close <= 0 || currentAtr === undefined) {
        continue;
      }

      // Collecter fenêtre funding
      const win: number[] = [];
      for (let j = i; j >= 0 && win.length < window; j--) {
        const v = funding[j];
        if (v !== undefined) win.unshift(v);
      }
      if (win.length < window) continue;

      const mean = win.reduce((a, b) => a + b, 0) / win.length;
      const sd = stdev(win, win.length)[win.length - 1];
      if (sd === undefined || sd === 0) continue;

      const z = (currentFunding - mean) / sd;
      const atrPct = Math.max(0.5, (currentAtr / candle.close) * 100);

      let facteurOi = 1;
      if (oi && i > 0) {
        const oiCurrent = oi[i];
        const oiPrev = oi[i - 1];
        if (oiCurrent !== undefined && oiPrev !== undefined && oiPrev > 0) {
          const deltaOiPct = ((oiCurrent - oiPrev) / oiPrev) * 100;
          if (deltaOiPct > 0) {
            facteurOi += Math.min(2, deltaOiPct / 10);
          }
        }
      }

      spiOut[i] = (z * facteurOi) / atrPct;
    }

    return {
      series: {
        spi: spiOut,
        seuilHaut,
        seuilBas,
      },
    };
  },
};
