import { describe, expect, it } from "vitest";
import { parseEvenements, parseZone } from "./gdelt";

// Fixture VERBATIM de la forme servie par le daemon (contrat Task 4).
const REPONSE = {
  majA: 1783728000000,
  couverture: { deMs: 1783720800000, aMs: 1783724400000 },
  cellules: [
    { lat: 48.5, lon: 35, categorie: "materiel", n: 12, intensite: 10, mentions: 40, dernierMs: 1783724400000 },
    { lat: 31.5, lon: 34.5, categorie: "protestation", n: 3, intensite: 6.5, mentions: 9, dernierMs: 1783720800000 },
  ],
};

describe("parseEvenements", () => {
  it("accepte la réponse daemon nominale", () => {
    const etat = parseEvenements(REPONSE);
    expect(etat?.cellules).toHaveLength(2);
    expect(etat?.majA).toBe(1783728000000);
    expect(etat?.couverture?.aMs).toBe(1783724400000);
  });
  it("accepte majA/couverture null (base vide) et filtre les cellules malformées", () => {
    const etat = parseEvenements({ majA: null, couverture: null, cellules: [{ lat: "x" }, REPONSE.cellules[0]] });
    expect(etat?.majA).toBeNull();
    expect(etat?.cellules).toHaveLength(1);
  });
  it("rejette les formes inattendues sans jeter", () => {
    expect(parseEvenements(null)).toBeNull();
    expect(parseEvenements({ cellules: "pas un tableau" })).toBeNull();
    expect(parseEvenements(42)).toBeNull();
  });
});

describe("parseZone", () => {
  it("accepte la réponse nominale et tolère les champs null", () => {
    const evts = parseZone({ evenements: [{ dateMs: 1, categorie: "coercition", codeCameo: "172", goldstein: -5, mentions: 2, acteur1: null, acteur2: "POLICE", url: null }] });
    expect(evts).toHaveLength(1);
    expect(evts?.[0]?.acteur2).toBe("POLICE");
  });
  it("neutralise une url non http(s) (défense en profondeur XSS) et conserve une url http(s) valide", () => {
    const evts = parseZone({
      evenements: [
        { dateMs: 1, categorie: "materiel", codeCameo: "190", goldstein: -8, mentions: 5, acteur1: "A", acteur2: "B", url: "javascript:alert(1)" },
        { dateMs: 2, categorie: "materiel", codeCameo: "190", goldstein: -8, mentions: 5, acteur1: "A", acteur2: "B", url: "https://example.com/a" },
      ],
    });
    expect(evts?.[0]?.url).toBeNull();
    expect(evts?.[1]?.url).toBe("https://example.com/a");
  });
  it("rejette sans jeter", () => {
    expect(parseZone(undefined)).toBeNull();
    expect(parseZone({})).toBeNull();
  });
});
