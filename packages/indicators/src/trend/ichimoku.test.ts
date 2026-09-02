/**
 * @axiom/indicators — trend/ichimoku.test.ts
 *
 * Ichimoku est un indicateur composite (décalages, médianes Donchian). On ne
 * fabrique PAS de « valeur attendue » globale : on teste des PROPRIÉTÉS structurelles
 * déterministes (amorçage, longueurs, relations de décalage, bornes des médianes).
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { ichimoku } from "./ichimoku";

/** Bougies synthétiques déterministes (onde sinusoïdale + dérive) à partir de l'index. */
function genCandles(n: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const base = 100 + i * 0.5 + Math.sin(i / 5) * 8;
    const high = base + 2;
    const low = base - 2;
    out.push({
      time: i * 60_000,
      open: base,
      high,
      low,
      close: base + Math.cos(i / 7),
      volume: 1,
    });
  }
  return out;
}

describe("Ichimoku", () => {
  const candles = genCandles(120);
  const disp = 26;
  const { series } = computeIndicator(ichimoku, candles, {
    tenkan: 9,
    kijun: 26,
    senkou: 52,
    displacement: disp,
  });

  it("expose les cinq sorties à la bonne longueur", () => {
    for (const key of ["tenkan", "kijun", "spanA", "spanB", "chikou"]) {
      const s = series[key];
      expect(s).toBeDefined();
      if (s === undefined) throw new Error(`série ${key} absente`);
      expect(s.length).toBe(candles.length);
    }
  });

  it("amorce correctement (undefined avant la fenêtre pleine)", () => {
    const tenkan = series.tenkan!;
    const kijun = series.kijun!;
    const spanB = series.spanB!;
    // Tenkan(9) : indices 0..7 undefined, défini à 8.
    expect(tenkan[7]).toBeUndefined();
    expect(tenkan[8]).toBeDefined();
    // Kijun(26) : défini à l'index 25.
    expect(kijun[24]).toBeUndefined();
    expect(kijun[25]).toBeDefined();
    // SpanB(52) décalé de 26 : défini seulement à partir de 51 + 26 = 77.
    expect(spanB[76]).toBeUndefined();
    expect(spanB[77]).toBeDefined();
  });

  it("chikou = close projeté de -displacement (relation exacte)", () => {
    const chikou = series.chikou!;
    const n = candles.length;
    for (let i = 0; i + disp < n; i++) {
      expect(chikou[i]).toBe(candles[i + disp]!.close);
    }
    // Queue laissée undefined.
    expect(chikou[n - 1]).toBeUndefined();
  });

  it("spanA = moyenne (tenkan,kijun) décalée de +displacement (relation exacte)", () => {
    const tenkan = series.tenkan!;
    const kijun = series.kijun!;
    const spanA = series.spanA!;
    for (let i = disp; i < candles.length; i++) {
      const t = tenkan[i - disp];
      const k = kijun[i - disp];
      if (t === undefined || k === undefined) continue;
      expect(spanA[i]).toBeCloseTo((t + k) / 2, 9);
    }
  });

  it("tenkan reste dans la fourchette high/low de sa fenêtre", () => {
    const tenkan = series.tenkan!;
    for (let i = 8; i < candles.length; i++) {
      const v = tenkan[i];
      if (v === undefined) continue;
      let hi = -Infinity;
      let lo = Infinity;
      for (let j = i - 8; j <= i; j++) {
        hi = Math.max(hi, candles[j]!.high);
        lo = Math.min(lo, candles[j]!.low);
      }
      expect(v).toBeLessThanOrEqual(hi);
      expect(v).toBeGreaterThanOrEqual(lo);
    }
  });

  it("décalage fractionnaire quantifié : displacement=25.5 -> arrondi 26, séries non vides", () => {
    const frac = computeIndicator(ichimoku, candles, {
      tenkan: 9,
      kijun: 26,
      senkou: 52,
      displacement: 25.5,
    }).series;
    expect(frac.spanA?.some((v) => v !== undefined)).toBe(true);
    expect(frac.spanB?.some((v) => v !== undefined)).toBe(true);
    expect(frac.chikou?.some((v) => v !== undefined)).toBe(true);
    expect(frac.spanA).toEqual(series.spanA);
    expect(frac.spanB).toEqual(series.spanB);
    expect(frac.chikou).toEqual(series.chikou);
  });
});
