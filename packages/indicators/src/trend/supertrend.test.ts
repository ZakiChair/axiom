/**
 * @axiom/indicators — trend/supertrend.test.ts
 *
 * SuperTrend dépend de l'ATR récursif et d'un état de tendance : on teste l'amorçage,
 * les bornes de la direction (+1/-1) et l'INVARIANT (en tendance haussière la ligne
 * suit la bande BASSE, donc passe sous la clôture).
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { supertrend } from "./supertrend";

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

describe("SuperTrend", () => {
  it("amorce avant la fenêtre ATR et borne la direction à {-1, +1}", () => {
    const rows: Array<[number, number, number]> = [];
    for (let i = 0; i < 40; i++) {
      const base = 100 + i;
      rows.push([base + 1, base - 1, base]);
    }
    const candles = candlesFromHLC(rows);
    const { series } = computeIndicator(supertrend, candles, {
      period: 10,
      multiplier: 3,
    });
    const line = series.line!;
    const direction = series.direction!;

    expect(line.length).toBe(candles.length);
    expect(direction.length).toBe(candles.length);

    // ATR(10) via rma -> première valeur définie à l'index 9.
    expect(line[8]).toBeUndefined();
    expect(line[9]).toBeDefined();

    for (let i = 0; i < direction.length; i++) {
      const d = direction[i];
      if (d === undefined) continue;
      expect(d === 1 || d === -1).toBe(true);
      expect(Number.isFinite(line[i])).toBe(true);
    }
  });

  it("en tendance haussière franche, la ligne passe sous la clôture (direction +1)", () => {
    const rows: Array<[number, number, number]> = [];
    for (let i = 0; i < 40; i++) {
      const base = 100 + i * 2;
      rows.push([base + 1, base - 1, base]);
    }
    const candles = candlesFromHLC(rows);
    const { series } = computeIndicator(supertrend, candles);
    const line = series.line!;
    const direction = series.direction!;

    for (let i = 20; i < candles.length; i++) {
      expect(direction[i]).toBe(1);
      const v = line[i];
      if (v === undefined) continue;
      expect(v).toBeLessThanOrEqual(candles[i]!.close);
    }
  });
});
