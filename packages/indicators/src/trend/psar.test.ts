/**
 * @axiom/indicators — trend/psar.test.ts
 *
 * Le Parabolic SAR est récursif (AF, renversements) : on ne fabrique pas de valeur
 * « attendue » globale, on teste l'amorçage, la finitude et l'INVARIANT directionnel
 * (en tendance haussière franche, le SAR reste sous les bas).
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { psar } from "./psar";

function candlesFromHL(rows: Array<[high: number, low: number]>): Candle[] {
  return rows.map(([high, low], i) => ({
    time: i * 60_000,
    open: (high + low) / 2,
    high,
    low,
    close: (high + low) / 2,
    volume: 0,
  }));
}

describe("Parabolic SAR (Wilder)", () => {
  it("amorce à l'index 0 undefined et produit des valeurs finies", () => {
    const candles = candlesFromHL([
      [10, 8],
      [11, 9],
      [12, 10],
      [13, 11],
      [14, 12],
    ]);
    const { series } = computeIndicator(psar, candles);
    const out = series.psar!;
    expect(out.length).toBe(candles.length);
    expect(out[0]).toBeUndefined();
    for (let i = 1; i < out.length; i++) {
      expect(Number.isFinite(out[i])).toBe(true);
    }
  });

  it("en tendance haussière franche, le SAR reste sous les plus bas", () => {
    // Hauts et bas strictement croissants -> tendance haussière sans renversement.
    const rows: Array<[number, number]> = [];
    for (let i = 0; i < 30; i++) rows.push([20 + i, 18 + i]);
    const candles = candlesFromHL(rows);
    const { series } = computeIndicator(psar, candles);
    const out = series.psar!;
    // Après quelques bougies, le SAR (stop suiveur haussier) est sous le bas courant.
    for (let i = 3; i < candles.length; i++) {
      const v = out[i];
      expect(v).toBeDefined();
      if (v === undefined) continue;
      expect(v).toBeLessThanOrEqual(candles[i]!.low);
    }
  });

  it("respecte le plafond d'AF (pas d'explosion numérique)", () => {
    const rows: Array<[number, number]> = [];
    for (let i = 0; i < 50; i++) rows.push([100 + i * 2, 98 + i * 2]);
    const candles = candlesFromHL(rows);
    const { series } = computeIndicator(psar, candles, { step: 0.02, max: 0.2 });
    const out = series.psar!;
    for (let i = 1; i < out.length; i++) {
      const v = out[i];
      if (v === undefined) continue;
      // Le SAR reste dans une fourchette raisonnable autour du prix.
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(candles[i]!.high + 10);
    }
  });
});
