import { describe, expect, test } from "bun:test";
import { extraireFichierZip } from "./zip";
import {
  agregerEvenements,
  categoriePourRacine,
  cleGrille,
  parseDateGdelt,
  parseLigneGdelt,
  parseTrancheGdelt,
} from "./gdelt";

/** Fabrique une ligne GDELT 61 colonnes avec surcharges par index (0-based). */
function ligne(patch: Record<number, string>): string {
  const c: string[] = new Array(61).fill("");
  c[0] = "1234567890"; // GlobalEventID
  c[26] = "190"; // EventCode
  c[28] = "19"; // EventRootCode (Fight)
  c[29] = "4"; // QuadClass
  c[30] = "-10.0"; // GoldsteinScale
  c[31] = "4"; // NumMentions
  c[56] = "48.45"; // ActionGeo_Lat
  c[57] = "35.02"; // ActionGeo_Long
  c[59] = "20260712001500"; // DATEADDED
  c[60] = "https://exemple.test/article";
  for (const [i, v] of Object.entries(patch)) c[Number(i)] = v;
  return c.join("\t");
}

describe("categoriePourRacine", () => {
  test("mappe 14→protestation, 15/16/17→coercition, 18/19/20→materiel, reste→null", () => {
    expect(categoriePourRacine("14")).toBe("protestation");
    expect(categoriePourRacine("15")).toBe("coercition");
    expect(categoriePourRacine("16")).toBe("coercition");
    expect(categoriePourRacine("17")).toBe("coercition");
    expect(categoriePourRacine("18")).toBe("materiel");
    expect(categoriePourRacine("19")).toBe("materiel");
    expect(categoriePourRacine("20")).toBe("materiel");
    expect(categoriePourRacine("13")).toBeNull();
    expect(categoriePourRacine("04")).toBeNull();
    expect(categoriePourRacine("")).toBeNull();
  });
});

describe("parseDateGdelt", () => {
  test("convertit YYYYMMDDHHMMSS (UTC) en epoch ms", () => {
    expect(parseDateGdelt("20260712001500")).toBe(Date.UTC(2026, 6, 12, 0, 15, 0));
  });
  test("rejette les formats invalides", () => {
    expect(parseDateGdelt("")).toBeNull();
    expect(parseDateGdelt("2026-07-12")).toBeNull();
  });
});

describe("parseLigneGdelt", () => {
  test("parse une ligne de combat complète", () => {
    const evt = parseLigneGdelt(ligne({ 6: "RUSSIA", 16: "UKRAINE" }));
    expect(evt).toEqual({
      idGdelt: "1234567890",
      dateMs: Date.UTC(2026, 6, 12, 0, 15, 0),
      lat: 48.45,
      lon: 35.02,
      codeCameo: "190",
      racine: "19",
      quadClass: 4,
      goldstein: -10,
      mentions: 4,
      acteur1: "RUSSIA",
      acteur2: "UKRAINE",
      url: "https://exemple.test/article",
      categorie: "materiel",
    });
  });
  test("rejette racine hors 14-20, géoloc vide, date invalide, nb de colonnes ≠ 61", () => {
    expect(parseLigneGdelt(ligne({ 28: "04" }))).toBeNull();
    expect(parseLigneGdelt(ligne({ 56: "" }))).toBeNull();
    expect(parseLigneGdelt(ligne({ 57: "" }))).toBeNull();
    expect(parseLigneGdelt(ligne({ 59: "hier" }))).toBeNull();
    expect(parseLigneGdelt("a\tb\tc")).toBeNull();
  });
  test("acteurs/url vides deviennent null, mentions invalides deviennent 0", () => {
    const evt = parseLigneGdelt(ligne({ 31: "n/a", 60: "" }));
    expect(evt?.acteur1).toBeNull();
    expect(evt?.acteur2).toBeNull();
    expect(evt?.url).toBeNull();
    expect(evt?.mentions).toBe(0);
  });
});

describe("parseTrancheGdelt sur la VRAIE tranche (fixture 2026-07-12)", () => {
  test("retient exactement 194 événements, répartition par racine connue", async () => {
    const zip = new Uint8Array(
      await Bun.file(new URL("./fixtures/gdelt-tranche-20260712001500.export.CSV.zip", import.meta.url)).arrayBuffer(),
    );
    const evenements = parseTrancheGdelt(new TextDecoder().decode(extraireFichierZip(zip)));
    expect(evenements.length).toBe(194);
    const parRacine = new Map<string, number>();
    for (const e of evenements) parRacine.set(e.racine, (parRacine.get(e.racine) ?? 0) + 1);
    expect(parRacine.get("14")).toBe(14);
    expect(parRacine.get("19")).toBe(90);
    expect(parRacine.get("20")).toBe(4);
  });
});

describe("agrégation grille 0,5°", () => {
  test("cleGrille arrondit au demi-degré", () => {
    expect(cleGrille(48.45)).toBe(48.5);
    expect(cleGrille(35.02)).toBe(35);
    expect(cleGrille(-0.26)).toBe(-0.5);
  });
  test("agrège par (cellule, catégorie) : n, mentions sommées, intensité max, dernierMs max", () => {
    const a = parseLigneGdelt(ligne({ 0: "1", 30: "-8.0", 31: "3", 59: "20260712001500" }));
    const b = parseLigneGdelt(ligne({ 0: "2", 30: "-10.0", 31: "5", 59: "20260712003000" }));
    const c = parseLigneGdelt(ligne({ 0: "3", 28: "14", 29: "3" })); // protestation, même cellule
    const d = parseLigneGdelt(ligne({ 0: "4", 56: "10.0", 57: "10.0" })); // autre cellule
    if (a === null || b === null || c === null || d === null) throw new Error("fixture invalide");
    const cellules = agregerEvenements([a, b, c, d]);
    expect(cellules.length).toBe(3);
    const combat = cellules.find((x) => x.categorie === "materiel" && x.lat === 48.5);
    expect(combat).toEqual({
      lat: 48.5, lon: 35, categorie: "materiel",
      n: 2, intensite: 10, mentions: 8, dernierMs: Date.UTC(2026, 6, 12, 0, 30, 0),
    });
  });
});
