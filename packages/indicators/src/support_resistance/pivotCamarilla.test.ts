/**
 * @axiom/indicators — support_resistance/pivotCamarilla.test.ts
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
 * Camarilla propre à ce fichier :
 *
 *   range = H − L = 4
 *   H1 = C + range·1.1/12 = 11 + 4·0.0916667 = 11.366667…
 *   H2 = C + range·1.1/6  = 11 + 0.733333 = 11.733333…
 *   H3 = C + range·1.1/4  = 11 + 1.1 = 12.1
 *   H4 = C + range·1.1/2  = 11 + 2.2 = 13.2
 *   L1 = C − range·1.1/12 = 10.633333…
 *   L2 = C − range·1.1/6  = 10.266667…
 *   L3 = C − range·1.1/4  = 9.9
 *   L4 = C − range·1.1/2  = 8.8
 *   PP = (12 + 8 + 11)/3 = 10.333333…
 *
 * Les bougies du jour 0 (indices 0, 1, 2) n'ont pas de jour précédent dans le
 * buffer -> `undefined`.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { pivotCamarilla } from "./pivotCamarilla";

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

describe("Pivot Points Camarilla (sessionné)", () => {
  it("bougies du jour 0 : undefined (pas de jour précédent dans le buffer)", () => {
    const { series } = computeIndicator(pivotCamarilla, candles, {});

    for (const key of ["pp", "h1", "h2", "h3", "h4", "l1", "l2", "l3", "l4"]) {
      const s = series[key];
      if (s === undefined) throw new Error(`série ${key} absente`);
      expect(s.length).toBe(candles.length);
      expect(s[0]).toBeUndefined();
      expect(s[1]).toBeUndefined();
      expect(s[2]).toBeUndefined();
    }
  });

  it("bougies du jour 1 : niveaux depuis les extents du jour 0 (hand-calc)", () => {
    const { series } = computeIndicator(pivotCamarilla, candles, {});

    const pp = series.pp!;
    const h1 = series.h1!;
    const h2 = series.h2!;
    const h3 = series.h3!;
    const h4 = series.h4!;
    const l1 = series.l1!;
    const l2 = series.l2!;
    const l3 = series.l3!;
    const l4 = series.l4!;

    for (const i of [3, 4, 5]) {
      expect(pp[i]).toBeCloseTo(10.3333333333, 9);
      expect(h1[i]).toBeCloseTo(11.3666666667, 9);
      expect(h2[i]).toBeCloseTo(11.7333333333, 9);
      expect(h3[i]).toBeCloseTo(12.1, 9);
      expect(h4[i]).toBeCloseTo(13.2, 9);
      expect(l1[i]).toBeCloseTo(10.6333333333, 9);
      expect(l2[i]).toBeCloseTo(10.2666666667, 9);
      expect(l3[i]).toBeCloseTo(9.9, 9);
      expect(l4[i]).toBeCloseTo(8.8, 9);
    }

    // Propriété clé du calcul sessionné : les niveaux sont CONSTANTS sur tout
    // le jour (contrairement à l'ancien calcul bougie-précédente).
    expect(h1[3]).toBe(h1[4]);
    expect(h1[4]).toBe(h1[5]);
  });


  // Buffer démarrant EN MILIEU DE JOURNÉE : le jour 0 est tronqué (première
  // bougie à 05:00 UTC), ses H/L/C ne sont donc pas ceux d'une session
  // entière. Les pivots du jour 1 doivent rester `undefined` plutôt que
  // d'afficher des niveaux faux (même convention que le « jour 0 »).
  const tronque: Candle[] = candles.map((c, i) =>
    i < 3 ? { ...c, time: c.time + 5 * HOUR_MS } : c,
  );

  it("veille PARTIELLE (buffer démarrant en milieu de journée) : undefined", () => {
    const { series } = computeIndicator(pivotCamarilla, tronque, {});

    for (const key of ["pp", "h1", "h2", "h3", "h4", "l1", "l2", "l3", "l4"]) {
      const serie = series[key]!;
      for (const i of [0, 1, 2, 3, 4, 5]) expect(serie[i]).toBeUndefined();
    }
  });
});
