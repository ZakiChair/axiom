import { describe, expect, it } from "vitest";
import type { MacroSeries } from "./macro/types";
import { normaliserSerie } from "./netliq";

describe("normaliserSerie — normalisation d'unités FRED vers Md$", () => {
  it("convertit les millions de dollars en milliards (WALCL/WTREGEN, facteur 1e-3)", () => {
    // Points bruts en Millions of U.S. Dollars (unité FRED de WALCL/WTREGEN).
    // time = 2026-06-24T00:00:00Z ; 918 696 M$ → 918,696 Md$.
    const brute: MacroSeries = [
      { time: Date.parse("2026-06-24T00:00:00Z"), value: 918696 },
      { time: Date.parse("2026-07-15T00:00:00Z"), value: 6735609 },
    ];
    expect(normaliserSerie(brute, 1e-3)).toEqual([
      { date: "2026-06-24", valeur: 918.696 },
      { date: "2026-07-15", valeur: 6735.609 },
    ]);
  });

  it("laisse inchangées les valeurs déjà en milliards (RRPONTSYD, facteur 1)", () => {
    const brute: MacroSeries = [{ time: Date.parse("2026-06-02T00:00:00Z"), value: 2.502 }];
    expect(normaliserSerie(brute, 1)).toEqual([{ date: "2026-06-02", valeur: 2.502 }]);
  });

  it("préserve l'ordre et renvoie une série vide pour une entrée vide", () => {
    expect(normaliserSerie([], 1e-3)).toEqual([]);
  });
});
