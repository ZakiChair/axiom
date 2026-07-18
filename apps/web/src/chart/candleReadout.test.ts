/**
 * Tests de la fonction PURE `lectureBougie` : variation % (clôture vs ouverture),
 * amplitude (haut−bas) et sens. Le rendu DOM de l'encart est vérifié en navigateur.
 */
import { describe, expect, it } from "vitest";
import { lectureBougie } from "./candleReadout";

describe("lectureBougie", () => {
  it("bougie haussière", () => {
    const r = lectureBougie({ open: 100, high: 112, low: 98, close: 108 });
    expect(r.variationPct).toBeCloseTo(8, 6);
    expect(r.amplitude).toBeCloseTo(14, 6);
    expect(r.hausse).toBe(true);
  });

  it("bougie baissière", () => {
    const r = lectureBougie({ open: 200, high: 205, low: 180, close: 190 });
    expect(r.variationPct).toBeCloseTo(-5, 6);
    expect(r.amplitude).toBeCloseTo(25, 6);
    expect(r.hausse).toBe(false);
  });

  it("doji (clôture = ouverture) → variation 0, hausse", () => {
    const r = lectureBougie({ open: 100, high: 101, low: 99, close: 100 });
    expect(r.variationPct).toBe(0);
    expect(r.amplitude).toBeCloseTo(2, 6);
    expect(r.hausse).toBe(true);
  });

  it("ouverture 0 ou non finie → variation NaN (pas de division par zéro)", () => {
    const r = lectureBougie({ open: 0, high: 5, low: 0, close: 3 });
    expect(Number.isNaN(r.variationPct)).toBe(true);
    expect(r.amplitude).toBeCloseTo(5, 6);
  });
});
