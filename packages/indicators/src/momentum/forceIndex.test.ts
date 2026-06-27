/**
 * @axiom/indicators — momentum/forceIndex.test.ts
 *
 * Force Index = EMA((c - cPrev) * vol, length). L'EMA est testée ailleurs ;
 * on vérifie ici l'amorçage, la longueur, la finitude et un invariant exact :
 * sur des clôtures CONSTANTES, rawFI == 0 partout -> Force Index == 0.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { forceIndex } from "./forceIndex";

function bar(close: number, volume: number, i: number): Candle {
  return { time: i * 60_000, open: close, high: close + 1, low: close - 1, close, volume };
}

describe("Force Index", () => {
  it("amorce correctement et reste fini (length=3)", () => {
    const closes = [10, 11, 10, 12, 13, 12, 14, 15];
    const candles = closes.map((c, i) => bar(c, 100 + i, i));
    const { series } = computeIndicator(forceIndex, candles, { length: 3 });
    const out = series.forceIndex;
    if (out === undefined) throw new Error("série forceIndex absente");

    expect(out.length).toBe(candles.length);
    // rawFI défini dès l'index 1 ; EMA(3) -> première valeur à l'index 3.
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeUndefined();
    expect(out[2]).toBeUndefined();
    expect(out[3]).toBeDefined();
    for (let i = 3; i < out.length; i++) {
      const v = out[i];
      expect(v).toBeDefined();
      if (v !== undefined) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("renvoie 0 sur des clôtures constantes (rawFI nul)", () => {
    const candles = [10, 10, 10, 10, 10, 10].map((c, i) => bar(c, 100, i));
    const { series } = computeIndicator(forceIndex, candles, { length: 3 });
    const out = series.forceIndex;
    if (out === undefined) throw new Error("série forceIndex absente");

    for (let i = 3; i < out.length; i++) {
      expect(out[i]).toBeCloseTo(0, 12);
    }
  });
});
