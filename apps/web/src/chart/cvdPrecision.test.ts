import { describe, expect, it } from "vitest";
import { precisionCvd } from "./cvdPrecision";

describe("precisionCvd — précision adaptée à l'amplitude de la série", () => {
  it("grands cumuls (≥ 10) : entier (comportement historique)", () => {
    expect(precisionCvd([120, -20795.18])).toBe(0);
  });

  it("petits cumuls (< 10) : 2 décimales — un CVD de 0,42 n'affiche plus « 0 »", () => {
    expect(precisionCvd([0.42, -3.1])).toBe(2);
  });

  it("cumuls minuscules (< 0,1) : 4 décimales", () => {
    expect(precisionCvd([0.003, -0.0071])).toBe(4);
  });

  it("ignore les valeurs non finies ; série vide = cas « minuscule » (rien d'affiché)", () => {
    expect(precisionCvd([])).toBe(4);
    expect(precisionCvd([Number.NaN, Number.POSITIVE_INFINITY, 42])).toBe(0);
  });
});
