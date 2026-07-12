import { describe, expect, test } from "bun:test";
import { agregerUcdp, choisirFichierCandidat, parseCsv } from "./ucdp";

describe("parseCsv (RFC 4180)", () => {
  test("champs simples, CRLF et ligne finale sans retour", () => {
    expect(parseCsv("a,b\r\nc,d")).toEqual([["a", "b"], ["c", "d"]]);
  });
  test("champs quotés : virgules, guillemets échappés et retours ligne INTERNES", () => {
    expect(parseCsv('a,"x, y",fin\n1,"il a dit ""non""\nsur deux lignes",2')).toEqual([
      ["a", "x, y", "fin"],
      ["1", 'il a dit "non"\nsur deux lignes', "2"],
    ]);
  });
  test("champs vides conservés", () => {
    expect(parseCsv("a,,c")).toEqual([["a", "", "c"]]);
  });
});

describe("choisirFichierCandidat", () => {
  test("choisit la version mensuelle la plus récente, ignore les fichiers trimestriels à 4 nombres", () => {
    const html = `
      <a href="candidateged/GEDEvent_v26_01_26_03.csv">t</a>
      <a href="candidateged/GEDEvent_v26_0_4.csv">a</a>
      <a href="candidateged/GEDEvent_v26_0_5.csv">b</a>`;
    expect(choisirFichierCandidat(html)).toBe("GEDEvent_v26_0_5.csv");
  });
  test("null si aucun fichier trouvé", () => {
    expect(choisirFichierCandidat("<html>rien</html>")).toBeNull();
  });
});

describe("agregerUcdp", () => {
  const ENTETE = ["id", "latitude", "longitude", "best", "side_a", "side_b", "date_start"];
  test("agrège par cellule 0,5° : morts sommés, n compté, acteurs du pire événement, dernierMs max", () => {
    const zones = agregerUcdp([
      ENTETE,
      ["1", "48.6", "35.1", "12", "Armée A", "Armée B", "2026-05-05 00:00:00.000"],
      ["2", "48.4", "34.9", "30", "Armée A", "Milice C", "2026-05-20 00:00:00.000"],
      ["3", "10.0", "10.0", "0", "X", "Y", "2026-05-01 00:00:00.000"],
    ]);
    expect(zones.length).toBe(2);
    const donbass = zones.find((z) => z.lat === 48.5);
    expect(donbass).toEqual({
      lat: 48.5, lon: 35, morts: 42, n: 2,
      sideA: "Armée A", sideB: "Milice C", // acteurs de l'événement le plus meurtrier (30 morts)
      dernierMs: Date.UTC(2026, 4, 20),
    });
  });
  test("ignore les lignes sans coordonnées valides et tolère best vide", () => {
    const zones = agregerUcdp([ENTETE, ["1", "", "35", "5", "A", "B", "2026-05-05 00:00:00.000"], ["2", "48", "35", "", "A", "B", "2026-05-05 00:00:00.000"]]);
    expect(zones.length).toBe(1);
    expect(zones[0]?.morts).toBe(0);
  });
  test("parse la VRAIE fixture UCDP (20 enregistrements, 49 colonnes)", async () => {
    const texte = await Bun.file(new URL("./fixtures/ucdp-extrait.csv", import.meta.url)).text();
    const lignes = parseCsv(texte);
    expect(lignes.length).toBe(21); // en-tête + 20 records
    expect(lignes[0]?.length).toBe(49);
    expect(lignes[0]?.[29]).toBe("latitude");
    const zones = agregerUcdp(lignes);
    expect(zones.length).toBeGreaterThan(0);
    for (const z of zones) {
      expect(Number.isFinite(z.lat)).toBe(true);
      expect(z.morts).toBeGreaterThanOrEqual(0);
    }
  });
});
