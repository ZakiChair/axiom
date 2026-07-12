import { describe, expect, it } from "vitest";
import { lignesEvenement, sousTitreSelection, titreSelection } from "./globeDetail.util";

const NOW = Date.UTC(2026, 6, 12, 12);

describe("globeDetail.util", () => {
  it("titres par type de sélection", () => {
    expect(titreSelection({ type: "evenement", lat: 48.5, lon: 35, cellule: { lat: 48.5, lon: 35, categorie: "materiel", n: 12, intensite: 10, mentions: 40, dernierMs: NOW } })).toBe("Conflit armé — zone 48.5, 35");
    expect(titreSelection({ type: "conflit", zone: { lat: 48.5, lon: 35, morts: 42, n: 2, sideA: "A", sideB: "B", dernierMs: NOW } })).toContain("UCDP");
    expect(titreSelection({ type: "chokepoint", chokepoint: { id: "c6", nom: "Détroit d'Ormuz", lat: 26.3, lon: 56.9, nNavires: 34, nTankers: 17, nCargos: 17, date: "2026-07-05" } })).toBe("Détroit d'Ormuz");
  });
  it("sous-titre événement : n, intensité, mentions (PAS d'assertion sur le format exact de formatAge)", () => {
    const st = sousTitreSelection({ type: "evenement", lat: 48.5, lon: 35, cellule: { lat: 48.5, lon: 35, categorie: "materiel", n: 12, intensite: 10, mentions: 40, dernierMs: NOW - 1_800_000 } }, NOW);
    expect(st).toContain("12 événements");
    expect(st).toContain("10.0/10");
    expect(st).toContain("40 mentions");
  });
  it("ligne d'événement : acteurs, code CAMEO, goldstein, mentions", () => {
    const l = lignesEvenement({ dateMs: NOW - 3_600_000, categorie: "coercition", codeCameo: "172", goldstein: -5, mentions: 3, acteur1: "GOV", acteur2: "PROTESTERS", url: "https://x.test/a" }, NOW);
    expect(l.entete).toContain("GOV");
    expect(l.entete).toContain("PROTESTERS");
    expect(l.detail).toContain("CAMEO 172");
    expect(l.detail).toContain("-5");
  });
  it("acteurs absents → libellé neutre", () => {
    const l = lignesEvenement({ dateMs: NOW, categorie: "materiel", codeCameo: "190", goldstein: -10, mentions: 1, acteur1: null, acteur2: null, url: null }, NOW);
    expect(l.entete.length).toBeGreaterThan(0);
  });
});
