import { describe, expect, it } from "vitest";
import { anneesDeMaturite } from "./courbeTaux.util";

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
  });
});
