/**
 * Couverture du helper pur de géométrie du rendu OCN (le dessin canvas
 * lui-même est validé à l'œil/E2E, comme les autres modules chart).
 */
import { describe, expect, it } from "vitest";
import { largeurBarre } from "./openCloseNet";

describe("largeurBarre — échelle linéaire bornée avec plancher de visibilité", () => {
  it("proportionnelle au max", () => {
    expect(largeurBarre(50, 100, 140)).toBe(70);
    expect(largeurBarre(100, 100, 140)).toBe(140);
  });

  it("valeur > 0 minuscule → plancher 2 px (jamais invisible)", () => {
    expect(largeurBarre(0.001, 100, 140)).toBe(2);
  });

  it("valeur nulle ou max nul → 0 (rien à dessiner)", () => {
    expect(largeurBarre(0, 100, 140)).toBe(0);
    expect(largeurBarre(10, 0, 140)).toBe(0);
  });
});
