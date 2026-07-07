/**
 * @axiom/indicators — support_resistance/pivotWoodie.test.ts
 *
 * Pivots sessionnés : les niveaux d'une bougie du jour UTC J sont calculés
 * depuis les extents (H/L/C) agrégés du jour UTC J-1.
 *
 * Fixture : 2 jours de bougies 1h (3 bougies/jour), à cheval sur la frontière
 * UTC à 86_400_000 ms (même fixture que pivotStandard.test.ts / utils-session.test.ts) :
 *
 *   Jour 0 (t = 0, 1h, 2h) : H0 = 12, L0 = 8, C0 = 11 (clôture de la dernière
 *     bougie du jour, index 2).
 *   Jour 1 (t = 24h, 25h, 26h) : H1 = 14, L1 = 9, C1 = 14.
 *
 * Valeurs ATTENDUES pour les bougies du jour 1 (indices 3, 4, 5), calculées à
 * la main depuis les extents du jour 0 (H=12, L=8, C=11) via la formule
 * Woodie propre à ce fichier :
 *
 *   PP = (H + L + 2·C)/4 = (12 + 8 + 22)/4 = 42/4 = 10.5
 *   R1 = 2·PP − L = 21 − 8 = 13
 *   S1 = 2·PP − H = 21 − 12 = 9
 *   R2 = PP + (H − L) = 10.5 + 4 = 14.5
 *   S2 = PP − (H − L) = 10.5 − 4 = 6.5
 *
 * Les bougies du jour 0 (indices 0, 1, 2) n'ont pas de jour précédent dans le
 * buffer -> `undefined`.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { pivotWoodie } from "./pivotWoodie";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const candles: Candle[] = [
  { time: 0, open: 9, high: 10, low: 8, close: 9, volume: 0 },
  { time: HOUR_MS, open: 9, high: 12, low: 8.5, close: 10, volume: 0 },
  { time: 2 * HOUR_MS, open: 10, high: 11, low: 9, close: 11, volume: 0 },
  { time: DAY_MS, open: 11, high: 13, low: 10, close: 12, volume: 0 },
  { time: DAY_MS + HOUR_MS, open: 12, high: 14, low: 11, close: 13, volume: 0 },
  { time: DAY_MS + 2 * HOUR_MS, open: 13, high: 13.5, low: 9, close: 14, volume: 0 },
];

describe("Pivot Points Woodie (sessionné)", () => {
  it("bougies du jour 0 : undefined (pas de jour précédent dans le buffer)", () => {
    const { series } = computeIndicator(pivotWoodie, candles, {});

    for (const key of ["pp", "r1", "s1", "r2", "s2"]) {
      const s = series[key];
      if (s === undefined) throw new Error(`série ${key} absente`);
      expect(s.length).toBe(candles.length);
      expect(s[0]).toBeUndefined();
      expect(s[1]).toBeUndefined();
      expect(s[2]).toBeUndefined();
    }
  });

  it("bougies du jour 1 : niveaux depuis les extents du jour 0 (hand-calc)", () => {
    const { series } = computeIndicator(pivotWoodie, candles, {});

    const pp = series.pp!;
    const r1 = series.r1!;
    const s1 = series.s1!;
    const r2 = series.r2!;
    const s2 = series.s2!;

    for (const i of [3, 4, 5]) {
      expect(pp[i]).toBeCloseTo(10.5, 9);
      expect(r1[i]).toBeCloseTo(13, 9);
      expect(s1[i]).toBeCloseTo(9, 9);
      expect(r2[i]).toBeCloseTo(14.5, 9);
      expect(s2[i]).toBeCloseTo(6.5, 9);
    }

    // Propriété clé du calcul sessionné : les niveaux sont CONSTANTS sur tout
    // le jour (contrairement à l'ancien calcul bougie-précédente).
    expect(pp[3]).toBe(pp[4]);
    expect(pp[4]).toBe(pp[5]);
  });
});
