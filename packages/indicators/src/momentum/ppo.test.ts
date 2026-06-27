/**
 * @axiom/indicators — momentum/ppo.test.ts
 *
 * PPO repose sur des EMA récursives -> on teste les PROPRIÉTÉS : amorçage,
 * longueur, finitude, l'identité exacte fast==slow -> PPO == 0, et le signe
 * (hausse continue -> EMA rapide > EMA lente -> PPO > 0).
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { ppo } from "./ppo";

function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    time: i * 60_000,
    open: close,
    high: close,
    low: close,
    close,
    volume: 0,
  }));
}

describe("PPO (Percentage Price Oscillator)", () => {
  it("fast == slow -> ligne PPO identiquement nulle", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i) * 5);
    const { series } = computeIndicator(ppo, candlesFromCloses(closes), {
      fast: 10,
      slow: 10,
      signal: 9,
    });
    const line = series.ppo;
    if (line === undefined) throw new Error("série ppo absente");
    for (const v of line) {
      if (v !== undefined) expect(v).toBeCloseTo(0, 12);
    }
  });

  it("amorçage undefined (slow=26) et hausse continue -> PPO > 0", () => {
    const closes = Array.from({ length: 50 }, (_, i) => 100 + i);
    const { series } = computeIndicator(ppo, candlesFromCloses(closes), {
      fast: 12,
      slow: 26,
      signal: 9,
    });
    const line = series.ppo;
    const signal = series.signal;
    if (line === undefined || signal === undefined) throw new Error("séries ppo absentes");

    expect(line.length).toBe(closes.length);
    // EMA lente définie à l'index slow-1 = 25 ; avant -> undefined.
    for (let i = 0; i < 25; i++) expect(line[i]).toBeUndefined();
    expect(line[25]).toBeDefined();

    for (let i = 25; i < closes.length; i++) {
      const v = line[i];
      expect(v).toBeDefined();
      if (v === undefined) continue;
      expect(Number.isFinite(v)).toBe(true);
      // EMA rapide au-dessus de la lente en tendance haussière -> PPO strictement positif.
      expect(v).toBeGreaterThan(0);
    }
    // La ligne signal existe et est finie une fois amorcée.
    const lastSig = signal[closes.length - 1];
    expect(lastSig).toBeDefined();
    if (lastSig !== undefined) expect(Number.isFinite(lastSig)).toBe(true);
  });
});
