import { describe, expect, it } from "vitest";
import { CATALOGUE_MACRO, INDICATEURS_MACRO, ORDRE_REGIONS, seriesDeIndicateur } from "./catalogueMacro";

describe("CATALOGUE_MACRO", () => {
  it("couvre les six régions pour le CPI en glissement annuel", () => {
    const regions = seriesDeIndicateur("cpi-aa").map((d) => d.region);
    expect([...regions].sort()).toEqual(["CN", "EZ", "IN", "JP", "UK", "US"]);
  });

  it("attribue un identifiant unique à chaque série", () => {
    const ids = CATALOGUE_MACRO.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("déclare un couleurTokenIndex distinct par région, dans 1..6", () => {
    // La POSITION dans ORDRE_REGIONS dérive le token de couleur `--serie-N` : deux
    // régions au même index tracteraient deux courbes de la même couleur.
    expect(ORDRE_REGIONS).toHaveLength(6);
    expect(new Set(ORDRE_REGIONS).size).toBe(ORDRE_REGIONS.length);
    for (const def of CATALOGUE_MACRO) {
      expect(ORDRE_REGIONS).toContain(def.region);
    }
  });

  it("référence un indicateur déclaré pour chaque série", () => {
    const declares = new Set(INDICATEURS_MACRO.map((i) => i.id));
    for (const def of CATALOGUE_MACRO) {
      expect(declares.has(def.indicateur)).toBe(true);
    }
  });
});

// GARDE-FOU CENTRAL DU LOT. Une clé OCDE multi-pays (« CHN+IND ») ou jokerisée
// (« JPN.M...... ») renvoie HTTP 200 en TRONQUANT SILENCIEUSEMENT une des séries.
// Mesuré en live le 2026-09-06 : avec startPeriod=2026-05, la clé CHN+IND rend
// 3 points pour la Chine et UN SEUL pour l'Inde, là où les appels unitaires en
// rendent 3 chacun. Ce test interdit la régression au niveau du catalogue.
describe("clés OCDE — aucune troncature silencieuse possible", () => {
  const clesOecd = CATALOGUE_MACRO.filter((d) => d.source.transport === "oecd").map((d) =>
    d.source.transport === "oecd" ? d.source.cle : "",
  );

  it("n'utilise jamais de clé multi-pays", () => {
    for (const cle of clesOecd) {
      expect(cle).not.toContain("+");
    }
  });

  it("spécifie entièrement chaque dimension (aucun segment vide)", () => {
    for (const cle of clesOecd) {
      const segments = cle.split(".");
      expect(segments.length).toBe(8);
      for (const s of segments) {
        expect(s.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("filtres Eurostat", () => {
  // Le poste coicop18 compte 555 modalités : une requête sous-filtrée renvoie
  // des milliers de valeurs en HTTP 200. Toutes les dimensions non temporelles
  // doivent donc être fixées.
  it("fixe les quatre dimensions non temporelles", () => {
    for (const def of CATALOGUE_MACRO) {
      if (def.source.transport !== "eurostat") continue;
      expect(Object.keys(def.source.filtres).sort()).toEqual(["coicop18", "freq", "geo", "unit"]);
    }
  });
});
