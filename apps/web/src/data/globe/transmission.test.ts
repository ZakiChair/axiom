import { describe, expect, it } from "vitest";
import type { EvenementDetail } from "./types";
import { dedupliquerEvenements, qualifierTransmission, mesurerAutourEvenement, lectureTransmission } from "./transmission";

const JOUR = 86_400_000;
const DATE = Date.UTC(2026, 8, 20);
const evt: EvenementDetail = { dateMs: DATE, categorie: "materiel", codeCameo: "190", goldstein: -9, mentions: 5, acteur1: "A", acteur2: "B", url: "https://example.org/article" };

describe("transmission géopolitique conditionnelle", () => {
  it("ne déduit pas de ticker ni de sens du score GDELT", () => {
    const scenario = qualifierTransmission(evt, "energie", "Si l'offre de pétrole est interrompue", ["ETHUSDT", "SPY", "USO"]);
    expect(scenario).not.toBeNull();
    expect(scenario!.expositions.reconnues.map((x) => x.symbol)).toEqual(["USO"]);
    expect(scenario!.expositions.inconnues).toEqual(["ETHUSDT", "SPY"]);
    expect(scenario!.condition).toMatch(/Si l'offre/);
    expect(lectureTransmission(scenario!, DATE + JOUR).nature).toBe("scenario-conditionnel");
  });

  it("refuse un événement individuel sans URL source ou une condition vide", () => {
    expect(qualifierTransmission({ ...evt, url: null }, "energie", "si...", ["USO"])).toBeNull();
    expect(qualifierTransmission({ ...evt, url: "javascript:alert(1)" }, "energie", "si...", ["USO"])).toBeNull();
    expect(qualifierTransmission({ ...evt, url: "data:text/html,test" }, "energie", "si...", ["USO"])).toBeNull();
    expect(qualifierTransmission(evt, "energie", " ", ["USO"])).toBeNull();
    expect(qualifierTransmission({ ...evt, dateMs: DATE + JOUR }, "energie", "si...", ["USO"])?.id)
      .toBe(qualifierTransmission(evt, "energie", "si...", ["USO"])?.id);
  });

  it("déduplique les reprises d'un même article et code sans fusionner les sources contradictoires", () => {
    expect(dedupliquerEvenements([evt, { ...evt, dateMs: DATE + JOUR, mentions: 8 }, { ...evt, url: "https://other.example/article" }])).toHaveLength(2);
  });

  it("compare deux séances closes autour du jour, sans annoncer de causalité", () => {
    const result = mesurerAutourEvenement(DATE, [
      { time: DATE - JOUR, close: 100, closed: true },
      { time: DATE, close: 102, closed: true },
      { time: DATE + JOUR, close: 104, closed: false },
    ], DATE + JOUR + 1000);
    expect(result).toMatchObject({ statut: "mesure", avant: { date: DATE - JOUR, prix: 100 }, apres: { date: DATE, prix: 102 } });
    expect(result.statut === "mesure" ? result.variationPct : null).toBeCloseTo(2);
    expect(result?.description).toMatch(/descriptive|sans causalit/i);
    expect(mesurerAutourEvenement(DATE + 2 * JOUR, [], DATE)).toMatchObject({ statut: "attente" });
  });
});
