/**
 * @axiom/indicators — momentum/connorsRsi.test.ts
 *
 * Connors RSI : composite (RSI prix + RSI streak + percentRank). On NE fabrique
 * PAS de valeur exacte (anti fausse-précision §15.4) ; on vérifie les INVARIANTS :
 * longueur, amorçage undefined, borne [0, 100], valeurs finies.
 *
 * On utilise rankLength réduit (5) pour déclencher l'indicateur avec un jeu modeste.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { connorsRsi } from "./connorsRsi";

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

/** Série déterministe et variée pour exercer streak + percentRank. */
function syntheticCloses(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(50 + 8 * Math.sin(i / 2.5) + 2 * Math.cos(i / 1.1) + (i % 4));
  }
  return out;
}

describe("Connors RSI", () => {
  const candles = candlesFromCloses(syntheticCloses(60));
  const { series } = computeIndicator(connorsRsi, candles, {
    rsiLength: 3,
    streakLength: 2,
    rankLength: 5,
  });

  it("aligne la sortie sur l'entrée et amorce undefined", () => {
    const out = series.crsi;
    if (out === undefined) throw new Error("série crsi absente");
    expect(out.length).toBe(candles.length);
    // Le percentRank (length=5) ne peut exister avant l'index 6.
    expect(out[0]).toBeUndefined();
    expect(out[5]).toBeUndefined();
  });

  it("respecte la borne [0, 100] et reste fini", () => {
    const out = series.crsi;
    if (out === undefined) throw new Error("série crsi absente");
    let defined = 0;
    for (const v of out) {
      if (v === undefined) continue;
      defined++;
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(defined).toBeGreaterThan(0);
  });
});
