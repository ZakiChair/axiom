/**
 * @axiom/indicators — support_resistance/pivotDemark.test.ts
 *
 * Pivots sessionnés : les niveaux d'une bougie du jour UTC J sont calculés
 * depuis les extents (O/H/L/C) agrégés du jour UTC J-1. DeMark est le seul
 * pivot du lot à consommer l'`open` de `SessionExtent` (ouverture de la
 * PREMIÈRE bougie du jour J-1).
 *
 * Fixture : 2 jours de bougies 1h (3 bougies/jour), à cheval sur la frontière
 * UTC à 86_400_000 ms (même fixture que pivotStandard.test.ts / utils-session.test.ts) :
 *
 *   Jour 0 (t = 0, 1h, 2h) : O0 = 9 (ouverture de la première bougie du jour,
 *     index 0), H0 = 12, L0 = 8, C0 = 11 (clôture de la dernière bougie du
 *     jour, index 2).
 *   Jour 1 (t = 24h, 25h, 26h) : O1 = 11, H1 = 14, L1 = 9, C1 = 14.
 *
 * Valeurs ATTENDUES pour les bougies du jour 1 (indices 3, 4, 5), calculées à
 * la main depuis les extents du jour 0 (O=9, H=12, L=8, C=11) via la formule
 * DeMark propre à ce fichier :
 *
 *   C (11) > O (9) -> X = 2·H + L + C = 24 + 8 + 11 = 43
 *   PP = X/4 = 43/4 = 10.75
 *   R1 = X/2 − L = 21.5 − 8 = 13.5
 *   S1 = X/2 − H = 21.5 − 12 = 9.5
 *
 * (Seule la branche C > O est exercée par cette fixture partagée ; les deux
 * autres branches — C < O et C = O — restent couvertes par la logique de
 * `calc`, INCHANGÉE par cette tâche, qui ne modifie que la fenêtre.)
 *
 * Les bougies du jour 0 (indices 0, 1, 2) n'ont pas de jour précédent dans le
 * buffer -> `undefined`.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { pivotDemark } from "./pivotDemark";

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

describe("Pivot Points DeMark (sessionné)", () => {
  it("bougies du jour 0 : undefined (pas de jour précédent dans le buffer)", () => {
    const { series } = computeIndicator(pivotDemark, candles, {});

    for (const key of ["pp", "r1", "s1"]) {
      const s = series[key];
      if (s === undefined) throw new Error(`série ${key} absente`);
      expect(s.length).toBe(candles.length);
      expect(s[0]).toBeUndefined();
      expect(s[1]).toBeUndefined();
      expect(s[2]).toBeUndefined();
    }
  });

  it("bougies du jour 1 : niveaux depuis les extents du jour 0, branche C>O (hand-calc)", () => {
    const { series } = computeIndicator(pivotDemark, candles, {});

    const pp = series.pp!;
    const r1 = series.r1!;
    const s1 = series.s1!;

    for (const i of [3, 4, 5]) {
      expect(pp[i]).toBeCloseTo(10.75, 9);
      expect(r1[i]).toBeCloseTo(13.5, 9);
      expect(s1[i]).toBeCloseTo(9.5, 9);
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
    const { series } = computeIndicator(pivotDemark, tronque, {});

    for (const key of ["pp", "r1", "s1"]) {
      const serie = series[key]!;
      for (const i of [0, 1, 2, 3, 4, 5]) expect(serie[i]).toBeUndefined();
    }
  });
});
