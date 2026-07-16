import { describe, expect, it } from "vitest";
import { estExtremeColonne, seuilDecile } from "./extremesColonne";

describe("seuilDecile", () => {
  it("valeur au rang ⌈q·n⌉−1 de la colonne triée (ABSOLUS gérés par l'appelant)", () => {
    const vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(seuilDecile(vals, 0.9)).toBe(9);
  });
  it("null sous 10 valeurs finies", () => {
    expect(seuilDecile([1, 2, 3], 0.9)).toBeNull();
    expect(seuilDecile([1, 2, 3, 4, 5, 6, 7, 8, 9, Number.NaN], 0.9)).toBeNull();
  });
});

describe("estExtremeColonne", () => {
  it("|v| ≥ seuil, tolère undefined et seuil null", () => {
    expect(estExtremeColonne(9.5, 9)).toBe(true);
    expect(estExtremeColonne(-9.5, 9)).toBe(true);
    expect(estExtremeColonne(5, 9)).toBe(false);
    expect(estExtremeColonne(undefined, 9)).toBe(false);
    expect(estExtremeColonne(9.5, null)).toBe(false);
  });
});
