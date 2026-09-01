/**
 * @axiom/indicators — momentum/mfi.test.ts
 *
 * Politique anti fausse-précision : on vérifie l'amorçage `undefined`, la longueur
 * de sortie et l'invariant de borne (MFI ∈ [0, 100]). Le cas dégénéré (flux
 * strictement haussier -> MFI = 100) est testé exactement car déterministe.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { mfi } from "./mfi";

/** Bougie complète déterministe à partir de h/l/c/v (tp = hlc3). */
function candle(i: number, high: number, low: number, close: number, volume: number): Candle {
  return { time: i * 60_000, open: low, high, low, close, volume };
}

describe("MFI (Money Flow Index)", () => {
  it("amorçage undefined avant la fenêtre pleine et longueur alignée (length=3)", () => {
    const candles: Candle[] = [
      candle(0, 11, 9, 10, 100),
      candle(1, 12, 10, 11, 120),
      candle(2, 11, 9, 10, 90),
      candle(3, 13, 11, 12, 150),
      candle(4, 14, 12, 13, 130),
      candle(5, 13, 11, 12, 110),
      candle(6, 15, 13, 14, 160),
    ];
    const { series } = computeIndicator(mfi, candles, { length: 3 });
    const out = series.mfi;
    if (out === undefined) throw new Error("série mfi absente");

    expect(out.length).toBe(candles.length);
    // Indices 0..2 : pas encore length variations de tp -> undefined.
    for (let i = 0; i < 3; i++) expect(out[i]).toBeUndefined();
    // À partir de l'index length : valeur publiée et bornée.
    for (let i = 3; i < candles.length; i++) {
      const v = out[i];
      expect(v).toBeDefined();
      if (v === undefined) continue;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it("flux strictement haussier -> MFI saturé à 100", () => {
    const candles: Candle[] = [10, 11, 12, 13, 14, 15].map((c, i) =>
      candle(i, c + 1, c - 1, c, 100)
    );
    const { series } = computeIndicator(mfi, candles, { length: 3 });
    const out = series.mfi;
    if (out === undefined) throw new Error("série mfi absente");
    // Aucun flux négatif -> negMF = 0 -> MFI = 100.
    expect(out[3]).toBe(100);
    expect(out[5]).toBe(100);
  });

  it("longueur fractionnaire quantifiée : length=2.5 -> arrondi 3, série non vide", () => {
    const candles: Candle[] = [
      candle(0, 11, 9, 10, 100),
      candle(1, 12, 10, 11, 120),
      candle(2, 11, 9, 10, 90),
      candle(3, 13, 11, 12, 150),
      candle(4, 14, 12, 13, 130),
      candle(5, 13, 11, 12, 110),
      candle(6, 15, 13, 14, 160),
    ];
    const frac = computeIndicator(mfi, candles, { length: 2.5 }).series.mfi;
    expect(frac?.some((v) => v !== undefined)).toBe(true);
    expect(frac).toEqual(computeIndicator(mfi, candles, { length: 3 }).series.mfi);
  });
});
