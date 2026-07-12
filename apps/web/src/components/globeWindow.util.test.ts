import { describe, expect, it } from "vitest";
import { noteConflits, noteEvenements, noteUkraine } from "./globeWindow.util";

const NOW = Date.UTC(2026, 6, 12, 12);

describe("notes de pied de fenêtre", () => {
  it("événements : compte de cellules + âge + couverture", () => {
    const note = noteEvenements(
      { cellules: [{ lat: 0, lon: 0, categorie: "materiel", n: 1, intensite: 1, mentions: 1, dernierMs: NOW }], majA: NOW - 120_000, couverture: { deMs: NOW - 24 * 3_600_000, aMs: NOW } },
      true, true, NOW,
    );
    expect(note).toContain("GDELT");
    expect(note).toContain("1 zone");
  });
  it("événements : daemon hors ligne explicitement dit", () => {
    expect(noteEvenements(null, true, false, NOW)).toContain("daemon hors ligne");
  });
  it("événements : couche désactivée", () => {
    expect(noteEvenements(null, false, true, NOW)).toContain("désactivé");
  });
  it("conflits : fichier + âge ; ukraine : n polygones + fraîcheur ISW", () => {
    expect(noteConflits({ zones: [], majA: NOW, fichier: "GEDEvent_v26_0_5.csv" }, true, true, NOW)).toContain("v26_0_5");
    expect(noteUkraine({ collection: {}, majMs: NOW - 3_600_000, n: 10 }, true, NOW)).toContain("ISW");
  });
});
