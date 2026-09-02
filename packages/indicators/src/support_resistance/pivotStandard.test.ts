/**
 * @axiom/indicators — support_resistance/pivotStandard.test.ts
 *
 * Pivots sessionnés : les niveaux d'une bougie du jour UTC J sont calculés
 * depuis les extents (H/L/C) agrégés du jour UTC J-1.
 *
 * Fixture : 2 jours de bougies 1h (3 bougies/jour), à cheval sur la frontière
 * UTC à 86_400_000 ms (mêmes valeurs que la fixture utils-session.test.ts) :
 *
 *   Jour 0 (t = 0, 1h, 2h) : H0 = 12, L0 = 8, C0 = 11 (clôture de la dernière
 *     bougie du jour, index 2).
 *   Jour 1 (t = 24h, 25h, 26h) : H1 = 14, L1 = 9, C1 = 14.
 *
 * Valeurs ATTENDUES pour les bougies du jour 1 (indices 3, 4, 5), calculées à
 * la main depuis les extents du jour 0 (H=12, L=8, C=11) :
 *
 *   PP = (12 + 8 + 11) / 3 = 31/3 = 10.333333…
 *   R1 = 2·PP − L = 62/3 − 8 = 38/3 = 12.666667…
 *   S1 = 2·PP − H = 62/3 − 12 = 26/3 = 8.666667…
 *   R2 = PP + (H − L) = 31/3 + 4 = 43/3 = 14.333333…
 *   S2 = PP − (H − L) = 31/3 − 4 = 19/3 = 6.333333…
 *   R3 = H + 2·(PP − L) = 12 + 14/3 = 50/3 = 16.666667…
 *   S3 = L − 2·(H − PP) = 8 − 10/3 = 14/3 = 4.666667…
 *
 * Les bougies du jour 0 (indices 0, 1, 2) n'ont pas de jour précédent dans le
 * buffer -> `undefined`.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { pivotStandard } from "./pivotStandard";

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

describe("Pivot Points Standard (sessionné)", () => {
  it("bougies du jour 0 : undefined (pas de jour précédent dans le buffer)", () => {
    const { series } = computeIndicator(pivotStandard, candles, {});

    for (const key of ["pp", "r1", "s1", "r2", "s2", "r3", "s3"]) {
      const s = series[key];
      if (s === undefined) throw new Error(`série ${key} absente`);
      expect(s.length).toBe(candles.length); // longueur alignée sur les bougies
      expect(s[0]).toBeUndefined();
      expect(s[1]).toBeUndefined();
      expect(s[2]).toBeUndefined();
    }
  });

  it("bougies du jour 1 : niveaux depuis les extents du jour 0 (hand-calc)", () => {
    const { series } = computeIndicator(pivotStandard, candles, {});

    const pp = series.pp!;
    const r1 = series.r1!;
    const s1 = series.s1!;
    const r2 = series.r2!;
    const s2 = series.s2!;
    const r3 = series.r3!;
    const s3 = series.s3!;

    for (const i of [3, 4, 5]) {
      expect(pp[i]).toBeCloseTo(10.3333333333, 9);
      expect(r1[i]).toBeCloseTo(12.6666666667, 9);
      expect(s1[i]).toBeCloseTo(8.6666666667, 9);
      expect(r2[i]).toBeCloseTo(14.3333333333, 9);
      expect(s2[i]).toBeCloseTo(6.3333333333, 9);
      expect(r3[i]).toBeCloseTo(16.6666666667, 9);
      expect(s3[i]).toBeCloseTo(4.6666666667, 9);
    }

    // Propriété clé du calcul sessionné : les niveaux sont CONSTANTS sur tout
    // le jour (contrairement à l'ancien calcul bougie-précédente).
    expect(pp[3]).toBe(pp[4]);
    expect(pp[4]).toBe(pp[5]);
  });


  // Buffer démarrant EN MILIEU DE JOURNÉE : le jour 0 est tronqué (première
  // bougie à 05:00 UTC), ses H/L/C ne sont donc pas ceux d'une session
  // entière. Les pivots du jour 1 doivent rester `undefined` plutôt que
  // d'afficher des niveaux faux (même convention que le « jour 0 »).
  const tronque: Candle[] = candles.map((c, i) =>
    i < 3 ? { ...c, time: c.time + 5 * HOUR_MS } : c,
  );

  it("veille PARTIELLE (buffer démarrant en milieu de journée) : undefined", () => {
    const { series } = computeIndicator(pivotStandard, tronque, {});

    for (const key of ["pp", "r1", "s1", "r2", "s2", "r3", "s3"]) {
      const serie = series[key]!;
      for (const i of [0, 1, 2, 3, 4, 5]) expect(serie[i]).toBeUndefined();
    }
  });
});
