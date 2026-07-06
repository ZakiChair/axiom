/**
 * Tests du helper pur de l'overlay VPFR (volumeRangeOverlay.ts) : rangeIndices
 * mappe une plage temporelle [t1, t2] (bornes dans n'importe quel ordre) vers des
 * indices de bougies inclusifs. Convention open-time : la bougie d'index i couvre
 * [times[i], times[i+1]) — un instant entre deux opens appartient à la bougie
 * OUVERTE avant lui (dernier index dont l'open <= t).
 */
import { describe, expect, it, vi } from "vitest";
import { rangeIndices } from "./volumeRangeOverlay";

// volumeRangeOverlay.ts appelle `registerOverlay` au chargement du module ; le build
// UMD de klinecharts ne s'évalue pas hors navigateur (pas de `window`), donc on stub
// l'unique export runtime utilisé (même parade que fibonacci.test.ts).
vi.mock("klinecharts", () => ({ registerOverlay: () => {} }));

describe("rangeIndices", () => {
  const times = [10, 20, 30, 40];

  it("timestamps exacts inclus aux deux bornes", () => {
    expect(rangeIndices(times, 20, 40)).toEqual({ from: 1, to: 3 });
  });

  it("réordonne les bornes et arrondit au bucket contenant (open-time)", () => {
    // 15 ∈ bougie ouverte à 10 (index 0) ; 35 ∈ bougie ouverte à 30 (index 2).
    expect(rangeIndices(times, 35, 15)).toEqual({ from: 0, to: 2 });
  });

  it("clampe la borne basse à 0 quand elle précède la première bougie", () => {
    expect(rangeIndices([10, 20, 30], 5, 25)).toEqual({ from: 0, to: 1 });
  });

  it("plage entièrement avant les données → null", () => {
    expect(rangeIndices([10, 20], 1, 5)).toBeNull();
  });

  it("plage entièrement après le dernier open → null", () => {
    expect(rangeIndices([10, 20], 50, 60)).toBeNull();
  });

  it("plage chevauchant la fin des données → tronquée au dernier index", () => {
    expect(rangeIndices([10, 20], 15, 60)).toEqual({ from: 0, to: 1 });
  });

  it("tableau vide → null", () => {
    expect(rangeIndices([], 10, 20)).toBeNull();
  });

  it("plage réduite à une seule bougie", () => {
    expect(rangeIndices(times, 22, 28)).toEqual({ from: 1, to: 1 });
  });
});
