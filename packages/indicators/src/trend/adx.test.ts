/**
 * @axiom/indicators — trend/adx.test.ts
 *
 * ADX/DMI est un composite à double lissage de Wilder : on teste les PROPRIÉTÉS
 * canoniques (bornes [0,100], amorçage, longueurs, et le fait que +DI domine -DI
 * dans une tendance haussière franche) plutôt qu'une fausse précision.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { adx } from "./adx";

function candlesFromHLC(
  rows: Array<[high: number, low: number, close: number]>
): Candle[] {
  return rows.map(([high, low, close], i) => ({
    time: i * 60_000,
    open: close,
    high,
    low,
    close,
    volume: 0,
  }));
}

describe("ADX / DMI (Wilder)", () => {
  const rows: Array<[number, number, number]> = [];
  for (let i = 0; i < 60; i++) {
    const base = 100 + i; // tendance haussière nette
    rows.push([base + 1, base - 1, base]);
  }
  const candles = candlesFromHLC(rows);
  const { series } = computeIndicator(adx, candles, { length: 14 });

  it("expose +DI / -DI / ADX à la bonne longueur", () => {
    for (const key of ["plusDI", "minusDI", "adx"]) {
      const s = series[key];
      expect(s).toBeDefined();
      if (s === undefined) throw new Error(`série ${key} absente`);
      expect(s.length).toBe(candles.length);
    }
  });

  it("borne toutes les sorties dans [0, 100] et reste fini", () => {
    for (const key of ["plusDI", "minusDI", "adx"]) {
      const s = series[key]!;
      for (let i = 0; i < s.length; i++) {
        const v = s[i];
        if (v === undefined) continue;
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it("amorce : +DI à l'index 14, ADX seulement après un second lissage", () => {
    const plusDI = series.plusDI!;
    const adxOut = series.adx!;
    // +DM/TR compactés (j->bougie j+1), rma(14) défini à j=13 -> bougie 14.
    expect(plusDI[13]).toBeUndefined();
    expect(plusDI[14]).toBeDefined();
    // ADX = rma(DX,14) : défini bien plus tard que +DI.
    expect(adxOut[14]).toBeUndefined();
  });

  it("+DI domine -DI dans une tendance haussière franche", () => {
    const plusDI = series.plusDI!;
    const minusDI = series.minusDI!;
    for (let i = 20; i < candles.length; i++) {
      const p = plusDI[i];
      const m = minusDI[i];
      if (p === undefined || m === undefined) continue;
      expect(p).toBeGreaterThan(m);
    }
  });
});
