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
