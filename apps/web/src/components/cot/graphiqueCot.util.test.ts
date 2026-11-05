import { describe, expect, it } from "vitest";
import type { PointHistoriqueCot } from "../../data/cotHistorique";
import {
  domaineVertical,
  formatAxeCot,
  formatValeurCot,
  indexPlusProche,
  ticksRonds,
  ticksTemps,
  valeurCot,
} from "./graphiqueCot.util";

const p = (t: number, oi: number, longs: number[], shorts: number[]): PointHistoriqueCot => ({ t, oi, longs, shorts });

describe("valeur tracée", () => {
  const pt = p(1, 1000, [300, NaN], [100, 50]);
  it("net en contrats ou en % de l'OI ; absent si un côté manque", () => {
    expect(valeurCot(pt, 0, "contrats")).toBe(200);
    expect(valeurCot(pt, 0, "pctOi")).toBe(20);
    expect(valeurCot(pt, 1, "contrats")).toBeNull();
    expect(valeurCot(p(1, NaN, [300], [100]), 0, "pctOi")).toBeNull();
  });
});

describe("graduations", () => {
  it("pas ronds et zéro exact", () => {
    expect(ticksRonds(-120_000, 260_000, 4)).toEqual([-100_000, 0, 100_000, 200_000]);
    expect(ticksRonds(-0.3, 0.7, 5)).toEqual([-0.2, 0, 0.2, 0.4, 0.6]);
    expect(ticksRonds(0, 25, 4)).toEqual([0, 10, 20]);
    expect(ticksRonds(5, 5, 4)).toEqual([]);
  });

  it("libellés d'axe compacts", () => {
    expect(formatAxeCot(-250_000, "contrats")).toBe("−250K");
    expect(formatAxeCot(1_200_000, "contrats")).toBe("1,2M");
    expect(formatAxeCot(2500, "contrats")).toBe("2,5K");
    expect(formatAxeCot(0, "contrats")).toBe("0");
    expect(formatAxeCot(-35, "pctOi")).toBe("−35 %");
    expect(formatAxeCot(2.5, "pctOi")).toBe("2,5 %");
  });

  it("décimales tirées du pas des graduations", () => {
    expect(ticksRonds(0, 1, 4)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect([0.25, 0.75].map((v) => formatAxeCot(v, "pctOi", 0.25))).toEqual(["0,25 %", "0,75 %"]);
    expect(formatAxeCot(37_500, "contrats", 12_500)).toBe("37,5K");
    expect(formatAxeCot(-2_000_000, "contrats", 500_000)).toBe("−2,0M");
    expect(formatAxeCot(0, "contrats", 500_000)).toBe("0");
    expect(formatAxeCot(0, "pctOi", 0.25)).toBe("0 %");
    expect(formatAxeCot(-20, "pctOi", 10)).toBe("−20 %");
  });

  it("valeurs signées exactes", () => {
    expect(formatValeurCot(123456, "contrats").replace(/\u202f|\u00a0/g, " ")).toBe("+123 456");
    expect(formatValeurCot(-5, "contrats")).toBe("−5");
    expect(formatValeurCot(-12.34, "pctOi")).toBe("−12,3 %");
    expect(formatValeurCot(null, "pctOi")).toBe("—");
  });
});

describe("axe du temps", () => {
  it("années sur une longue plage", () => {
    const ticks = ticksTemps(new Date(2016, 4, 10).getTime(), new Date(2026, 9, 27).getTime(), 6);
    expect(ticks.map((t) => t.label)).toEqual(["2018", "2020", "2022", "2024", "2026"]);
    for (const t of ticks) expect(new Date(t.t).getMonth()).toBe(0);
  });

  it("mois/trimestres sur une plage courte, jamais avant le début", () => {
    const min = new Date(2026, 0, 15).getTime();
    const ticks = ticksTemps(min, new Date(2026, 9, 27).getTime(), 6);
    expect(ticks.length).toBeLessThanOrEqual(6);
    expect(ticks[0]!.t).toBeGreaterThanOrEqual(min);
    expect(ticks.map((t) => new Date(t.t).getMonth())).toEqual([2, 4, 6, 8]); // pas de 2 mois
  });

  it("plage invalide : aucune graduation", () => {
    expect(ticksTemps(10, 10, 5)).toEqual([]);
  });
});

describe("domaine vertical et curseur", () => {
  const points = [
    p(10, 1000, [300, 100], [100, 400]),
    p(20, 1000, [500, 100], [100, 100]),
    p(30, 1000, [900, 100], [100, 100]),
  ];

  it("couvre les catégories visibles de la plage affichée, zéro compris", () => {
    const d = domaineVertical(points, [0], "contrats", { min: 0, max: 25 })!;
    expect(d.min).toBeLessThan(0);
    expect(d.max).toBeGreaterThan(400);
    expect(d.max).toBeLessThan(800); // le point à t=30 est hors plage
    const avecShorts = domaineVertical(points, [0, 1], "contrats", { min: 0, max: 25 })!;
    expect(avecShorts.min).toBeLessThan(-300);
    expect(domaineVertical(points, [], "contrats", { min: 0, max: 40 })).toBeNull();
  });

  it("rapport le plus proche du curseur", () => {
    expect(indexPlusProche(points, 0)).toBe(0);
    expect(indexPlusProche(points, 14)).toBe(0);
    expect(indexPlusProche(points, 16)).toBe(1);
    expect(indexPlusProche(points, 99)).toBe(2);
    expect(indexPlusProche([], 5)).toBe(-1);
  });
});
