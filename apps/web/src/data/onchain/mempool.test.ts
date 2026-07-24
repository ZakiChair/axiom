import { describe, expect, it } from "vitest";
import {
  computeHalving,
  parseAjustementDifficulte,
  parseFrais,
  parseHashrate,
  parseHashrateDifficulte,
} from "./mempool";

describe("computeHalving", () => {
  it("calcule le prochain halving depuis une hauteur courante", () => {
    const h = computeHalving(956_287);
    expect(h.prochainBloc).toBe(1_050_000);
    expect(h.blocsRestants).toBe(93_713);
    expect(h.index).toBe(5);
    expect(h.recompenseApres).toBeCloseTo(1.5625, 6); // 50 / 2^5
    expect(h.msEstimes).toBe(93_713 * 600_000);
  });

  it("gère le tout premier halving (hauteur 0)", () => {
    const h = computeHalving(0);
    expect(h.prochainBloc).toBe(210_000);
    expect(h.index).toBe(1);
    expect(h.recompenseApres).toBe(25);
  });

  it("avance au halving suivant quand on est pile sur un multiple de 210k", () => {
    const h = computeHalving(210_000);
    expect(h.prochainBloc).toBe(420_000);
    expect(h.index).toBe(2);
    expect(h.recompenseApres).toBe(12.5);
  });
});

describe("parseFrais", () => {
  it("extrait les frais recommandés", () => {
    const f = parseFrais({ fastestFee: 5, halfHourFee: 4, hourFee: 3, economyFee: 2, minimumFee: 1 });
    expect(f).toEqual({ fastestFee: 5, halfHourFee: 4, hourFee: 3, economyFee: 2, minimumFee: 1 });
  });

  it("renvoie NaN pour les champs absents (rendu → « — »)", () => {
    const f = parseFrais({});
    expect(Number.isNaN(f.fastestFee)).toBe(true);
  });
});

describe("parseHashrate", () => {
  it("convertit les timestamps (secondes) et trie", () => {
    const serie = parseHashrate({
      hashrates: [
        { timestamp: 1751587200, avgHashrate: 8.8e20 },
        { timestamp: 1751500800, avgHashrate: 8.7e20 },
      ],
    });
    expect(serie.points.length).toBe(2);
    expect(serie.points[0]?.time).toBe(1751500800 * 1000);
    expect(serie.dernier?.value).toBe(8.8e20);
  });

  it("tolère une forme inattendue", () => {
    expect(parseHashrate({}).points).toEqual([]);
    expect(parseHashrate(null).dernier).toBeUndefined();
  });
});

describe("parseHashrateDifficulte", () => {
  // Forme RÉELLE observée le 2026-07-24 : `difficulty:[{ time(s), height, difficulty,
  // adjustment }]` À CÔTÉ de `hashrates:[{ timestamp(s), avgHashrate }]` (26 vs 365 pts).
  const brut = {
    hashrates: [
      { timestamp: 1751500800, avgHashrate: 8.7e20 },
      { timestamp: 1751587200, avgHashrate: 8.8e20 },
    ],
    difficulty: [
      { time: 1751587200, height: 907200, difficulty: 1.2762e14, adjustment: 1.01 },
      { time: 1751500800, height: 904192, difficulty: 1.2632e14, adjustment: -0.05 },
    ],
    currentHashrate: 9.14e20,
    currentDifficulty: 1.2717e14,
  };

  it("extrait DEUX séries triées (hashrate H/s + difficulté)", () => {
    const { hashrate, difficulte } = parseHashrateDifficulte(brut);
    expect(hashrate.points.length).toBe(2);
    expect(hashrate.dernier?.value).toBe(8.8e20);
    expect(difficulte.points.length).toBe(2);
    // La difficulté est triée chrono ↑ : le point le plus ancien d'abord.
    expect(difficulte.points[0]?.value).toBe(1.2632e14);
    expect(difficulte.dernier?.value).toBe(1.2762e14);
    expect(difficulte.points[0]?.time).toBe(1751500800 * 1000);
  });

  it("tolère `timestamp` en repli sur `time` pour la difficulté", () => {
    const { difficulte } = parseHashrateDifficulte({
      difficulty: [{ timestamp: 1751587200, difficulty: 5e13 }],
    });
    expect(difficulte.points[0]?.time).toBe(1751587200 * 1000);
    expect(difficulte.points[0]?.value).toBe(5e13);
  });

  it("ne casse PAS le parseur hashrate historique (mêmes points que parseHashrate)", () => {
    const { hashrate } = parseHashrateDifficulte(brut);
    expect(hashrate.points).toEqual(parseHashrate(brut).points);
  });

  it("tolère une forme inattendue (deux séries vides)", () => {
    const r = parseHashrateDifficulte(null);
    expect(r.hashrate.points).toEqual([]);
    expect(r.difficulte.points).toEqual([]);
  });
});

describe("parseAjustementDifficulte", () => {
  it("extrait la progression, le changement et la date de retarget", () => {
    const a = parseAjustementDifficulte({
      progressPercent: 88.88,
      difficultyChange: -0.2877,
      estimatedRetargetDate: 1785014317784,
      remainingBlocks: 224,
      previousRetarget: -5.0044,
    });
    expect(a.progressPercent).toBeCloseTo(88.88, 4);
    expect(a.difficultyChange).toBeCloseTo(-0.2877, 4);
    expect(a.estimatedRetargetDate).toBe(1785014317784);
    expect(a.remainingBlocks).toBe(224);
    expect(a.previousRetarget).toBeCloseTo(-5.0044, 4);
  });

  it("renvoie NaN pour les champs absents (rendu → « — »)", () => {
    const a = parseAjustementDifficulte({});
    expect(Number.isNaN(a.progressPercent)).toBe(true);
    expect(Number.isNaN(a.difficultyChange)).toBe(true);
    expect(Number.isNaN(a.estimatedRetargetDate)).toBe(true);
  });
});
