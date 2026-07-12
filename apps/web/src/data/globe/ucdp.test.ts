import { describe, expect, it } from "vitest";
import { parseConflitsUcdp } from "./ucdp";

describe("parseConflitsUcdp", () => {
  it("accepte la réponse daemon nominale", () => {
    const etat = parseConflitsUcdp({
      majA: 1783728000000,
      fichier: "GEDEvent_v26_0_5.csv",
      zones: [{ lat: 48.5, lon: 35, morts: 42, n: 2, sideA: "Armée A", sideB: "Milice C", dernierMs: 1779580800000 }],
    });
    expect(etat?.zones).toHaveLength(1);
    expect(etat?.fichier).toBe("GEDEvent_v26_0_5.csv");
  });
  it("filtre les zones malformées, rejette les formes inattendues sans jeter", () => {
    expect(parseConflitsUcdp({ majA: 1, fichier: "f", zones: [{ lat: "x" }] })?.zones).toHaveLength(0);
    expect(parseConflitsUcdp(null)).toBeNull();
    expect(parseConflitsUcdp({ zones: [] })).toBeNull(); // majA/fichier manquants
  });
});
