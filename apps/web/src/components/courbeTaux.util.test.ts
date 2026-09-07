import { describe, expect, it } from "vitest";
import { anneesDeMaturite, pointsDeCourbe } from "./courbeTaux.util";

describe("anneesDeMaturite", () => {
  it("convertit les mois en fraction d'année", () => {
    expect(anneesDeMaturite("1 Mo")).toBeCloseTo(1 / 12);
    expect(anneesDeMaturite("6 Mo")).toBeCloseTo(0.5);
  });
  it("convertit les années directement", () => {
    expect(anneesDeMaturite("10 Yr")).toBe(10);
    expect(anneesDeMaturite("30 Yr")).toBe(30);
  });
  it("gère le libellé irrégulier « 1.5 Month » (colonne réelle du CSV Trésor US)", () => {
    expect(anneesDeMaturite("1.5 Month")).toBeCloseTo(1.5 / 12);
  });
  it("NaN sur forme inconnue", () => {
    expect(Number.isNaN(anneesDeMaturite("???"))).toBe(true);
    expect(Number.isNaN(anneesDeMaturite("10 Yr (indexée)"))).toBe(true);
  });
});

describe("pointsDeCourbe", () => {
  const rendements = { "2 Yr": 4.14, "10 Yr": 4.49, "10 Yr (indexée)": 2.5 };

  it("projette les maturités présentes dans l'ordre demandé, avec les années", () => {
    const pts = pointsDeCourbe(rendements, ["2 Yr", "10 Yr"]);
    expect(pts).toEqual([
      { maturite: "2 Yr", anneesTri: 2, taux: 4.14 },
      { maturite: "10 Yr", anneesTri: 10, taux: 4.49 },
    ]);
  });

  it("écarte les maturités absentes et les libellés non convertibles (indexée)", () => {
    const pts = pointsDeCourbe(rendements, ["2 Yr", "30 Yr", "10 Yr (indexée)"]);
    expect(pts).toEqual([{ maturite: "2 Yr", anneesTri: 2, taux: 4.14 }]);
  });

  it("observation absente → [] (dégradation gracieuse)", () => {
    expect(pointsDeCourbe(undefined, ["2 Yr"])).toEqual([]);
  });
});

import { pointsDeSerieTemporelle } from "./courbeTaux.util";

describe("pointsDeSerieTemporelle", () => {
  it("projette le temps en années décimales strictement croissantes", () => {
    const pts = pointsDeSerieTemporelle([
      { time: Date.UTC(2026, 4, 1), value: 3.2 },
      { time: Date.UTC(2026, 5, 1), value: 2.8 },
      { time: Date.UTC(2027, 0, 1), value: 2.1 },
    ]);
    expect(pts).toHaveLength(3);
    expect(pts[0]!.anneesTri).toBeLessThan(pts[1]!.anneesTri);
    expect(pts[1]!.anneesTri).toBeLessThan(pts[2]!.anneesTri);
    expect(pts.map((p) => p.taux)).toEqual([3.2, 2.8, 2.1]);
  });

  it("étiquette chaque point par mois et année abrégée", () => {
    const pts = pointsDeSerieTemporelle([{ time: Date.UTC(2026, 6, 1), value: 1.9 }]);
    expect(pts[0]!.maturite).toBe("juil. 26");
  });

  // L'infobulle de CourbeTaux apparie les points PAR IDENTITÉ DE CHAÎNE : deux points
  // distincts ne doivent jamais porter la même étiquette, sinon un pays affiche la
  // valeur d'un autre mois.
  it("produit des étiquettes uniques sur douze mois consécutifs", () => {
    const serie = Array.from({ length: 12 }, (_, i) => ({
      time: Date.UTC(2026, i, 1),
      value: i,
    }));
    const labels = pointsDeSerieTemporelle(serie).map((p) => p.maturite);
    expect(new Set(labels).size).toBe(12);
  });

  it("rend un tableau vide sur une série vide", () => {
    expect(pointsDeSerieTemporelle([])).toEqual([]);
  });
});
