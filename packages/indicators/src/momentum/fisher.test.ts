/**
 * @axiom/indicators — momentum/fisher.test.ts
 *
 * Fisher Transform : récursif et non-linéaire -> on teste les PROPRIÉTÉS (pas de
 * fausse précision) : amorçage undefined, longueur, finitude, décalage du trigger,
 * et le fait que la transformée conserve le signe de la position normalisée
 * (prix au plus haut de la fenêtre -> Fisher > 0 ; au plus bas -> Fisher < 0).
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { fisher } from "./fisher";

function candle(i: number, high: number, low: number): Candle {
  const c = (high + low) / 2;
  return { time: i * 60_000, open: c, high, low, close: c, volume: 0 };
}

describe("Fisher Transform", () => {
  it("amorçage undefined, longueur et finitude (length=9)", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 30; i++) {
      const base = 100 + Math.sin(i * 0.5) * 10;
      candles.push(candle(i, base + 1, base - 1));
    }
    const { series } = computeIndicator(fisher, candles, { length: 9 });
    const f = series.fisher;
    const trig = series.trigger;
    if (f === undefined || trig === undefined) throw new Error("séries fisher absentes");

    expect(f.length).toBe(candles.length);
    expect(trig.length).toBe(candles.length);

    // Avant la fenêtre pleine (index < 8) -> undefined.
    for (let i = 0; i < 8; i++) {
      expect(f[i]).toBeUndefined();
      expect(trig[i]).toBeUndefined();
    }
    // Première valeur Fisher à l'index 8 ; trigger décalé d'une barre (index 9).
    expect(f[8]).toBeDefined();
    expect(trig[8]).toBeUndefined();
    expect(trig[9]).toBe(f[8]);

    for (let i = 8; i < candles.length; i++) {
      const v = f[i];
      if (v !== undefined) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("conserve le signe de la position normalisée (haut -> +, bas -> -)", () => {
    // Hausse forte et continue : le prix médian colle au plus haut de la fenêtre,
    // raw -> 1, value -> positif -> Fisher positif sur le régime établi.
    const up: Candle[] = [];
    for (let i = 0; i < 20; i++) up.push(candle(i, 100 + i * 2 + 1, 100 + i * 2 - 1));
    const fUp = computeIndicator(fisher, up, { length: 9 }).series.fisher;
    if (fUp === undefined) throw new Error("série fisher absente");
    expect(fUp[19]).toBeGreaterThan(0);

    // Baisse forte et continue : prix au plus bas -> Fisher négatif.
    const down: Candle[] = [];
    for (let i = 0; i < 20; i++) down.push(candle(i, 200 - i * 2 + 1, 200 - i * 2 - 1));
    const fDown = computeIndicator(fisher, down, { length: 9 }).series.fisher;
    if (fDown === undefined) throw new Error("série fisher absente");
    expect(fDown[19]).toBeLessThan(0);
  });
});
