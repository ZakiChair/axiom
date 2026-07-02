import { describe, expect, it } from "vitest";
import { computeHalving, parseFrais, parseHashrate } from "./mempool";

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
