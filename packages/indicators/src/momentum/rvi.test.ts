/**
 * @axiom/indicators — momentum/rvi.test.ts
 *
 * RVI est un indicateur composé (lissage 4 barres + ratio de sommes) : on évite
 * la fausse précision et on teste des PROPRIÉTÉS + un invariant exact.
 *
 * Invariant : si chaque bougie vérifie (close - open) == (high - low) — ici
 * open=low=10, close=high=11 -> co=hl=1 — alors num4 == den4 sur toute fenêtre,
 * donc RVI == 1 exactement, et Signal == (1+2+2+1)/6 == 1.
 *
 * Amorçage (length=2) : num4/den4 dès i>=3 ; RVI dès i>=length+2=4 ;
 * Signal dès i>=length+5=7.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { rvi } from "./rvi";

const bars: Candle[] = Array.from({ length: 10 }, (_, i) => ({
  time: i * 60_000,
  open: 10,
  high: 11,
  low: 10,
  close: 11,
  volume: 100,
}));

describe("RVI (Relative Vigor Index)", () => {
  it("respecte longueur, amorçage et l'invariant co==hl -> RVI==1 (length=2)", () => {
    const { series } = computeIndicator(rvi, bars, { length: 2 });
    const line = series.rvi;
    const signal = series.signal;
    if (line === undefined || signal === undefined) throw new Error("séries rvi absentes");

    expect(line.length).toBe(bars.length);
    expect(signal.length).toBe(bars.length);

    // Amorçage RVI : indices < 4 sans valeur.
    for (let i = 0; i < 4; i++) expect(line[i]).toBeUndefined();
    // co == hl partout -> RVI == 1.
    for (let i = 4; i < bars.length; i++) {
      expect(line[i]).toBeCloseTo(1, 12);
    }

    // Amorçage Signal : indices < 7 sans valeur, puis == 1.
    for (let i = 0; i < 7; i++) expect(signal[i]).toBeUndefined();
    for (let i = 7; i < bars.length; i++) {
      expect(signal[i]).toBeCloseTo(1, 12);
    }
  });

  it("produit des valeurs finies sur des données variées", () => {
    const varied: Candle[] = [12, 11, 13, 14, 12, 15, 14, 16, 15, 17, 16, 18].map(
      (c, i) => ({
        time: i * 60_000,
        open: c - 0.5,
        high: c + 1,
        low: c - 1,
        close: c,
        volume: 100,
      })
    );
    const { series } = computeIndicator(rvi, varied, { length: 4 });
    const line = series.rvi;
    if (line === undefined) throw new Error("série rvi absente");
    for (const v of line) {
      if (v === undefined) continue;
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("longueur fractionnaire quantifiée : length=3.5 -> arrondi 4, série non vide", () => {
    const varied: Candle[] = [12, 11, 13, 14, 12, 15, 14, 16, 15, 17, 16, 18].map(
      (c, i) => ({
        time: i * 60_000,
        open: c - 0.5,
        high: c + 1,
        low: c - 1,
        close: c,
        volume: 100,
      })
    );
    const frac = computeIndicator(rvi, varied, { length: 3.5 }).series.rvi;
    expect(frac?.some((v) => v !== undefined)).toBe(true);
    expect(frac).toEqual(computeIndicator(rvi, varied, { length: 4 }).series.rvi);
  });
});
