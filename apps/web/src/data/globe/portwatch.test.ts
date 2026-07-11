import { describe, expect, it } from "vitest";
import { parseChokepoints } from "./portwatch";

// FIXTURES RÉELLES — extraits verbatim des réponses ArcGIS PortWatch refetchées en
// direct le 2026-07-10 (mêmes formes que l'API : { features: [{ attributes }] }).
// Référence : PortWatch_chokepoints_database (portid, portname, lat, lon).
const refJson = {
  objectIdFieldName: "ObjectId",
  geometryType: "esriGeometryPoint",
  features: [
    { attributes: { portid: "chokepoint1", portname: "Suez Canal", lat: 30.59334599, lon: 32.43688221 } },
    { attributes: { portid: "chokepoint4", portname: "Bab el-Mandeb Strait", lat: 12.78859715, lon: 43.34954476 } },
    { attributes: { portid: "chokepoint6", portname: "Strait of Hormuz", lat: 26.29685349, lon: 56.85984844 } },
    { attributes: { portid: "chokepoint7", portname: "Cape of Good Hope", lat: -34.92728556, lon: 20.88273666 } },
  ],
};

// Journalier : Daily_Chokepoints_Data trié date DESC (le champ date, type
// esriFieldTypeDateOnly, arrive en CHAÎNE « YYYY-MM-DD » — vérifié en direct).
// Deux jours par chokepoint pour vérifier la sélection du DERNIER point.
const dailyJson = {
  objectIdFieldName: "ObjectId",
  features: [
    { attributes: { date: "2026-07-05", portid: "chokepoint1", n_tanker: 20, n_cargo: 26, n_total: 46 } },
    { attributes: { date: "2026-07-05", portid: "chokepoint4", n_tanker: 13, n_cargo: 21, n_total: 34 } },
    { attributes: { date: "2026-07-05", portid: "chokepoint6", n_tanker: 17, n_cargo: 17, n_total: 34 } },
    { attributes: { date: "2026-07-04", portid: "chokepoint1", n_tanker: 20, n_cargo: 21, n_total: 41 } },
    { attributes: { date: "2026-07-04", portid: "chokepoint4", n_tanker: 15, n_cargo: 16, n_total: 31 } },
    { attributes: { date: "2026-07-04", portid: "chokepoint6", n_tanker: 11, n_cargo: 14, n_total: 25 } },
    { attributes: { date: "2026-07-04", portid: "chokepoint7", n_tanker: 11, n_cargo: 57, n_total: 68 } },
  ],
};

describe("parseChokepoints", () => {
  it("croise référence et journalier en gardant le DERNIER point par chokepoint", () => {
    const cps = parseChokepoints(refJson, dailyJson);
    expect(cps).toHaveLength(4);
    const ormuz = cps.find((c) => c.id === "chokepoint6");
    expect(ormuz).toEqual({
      id: "chokepoint6",
      nom: "Détroit d'Ormuz",
      lat: 26.29685349,
      lon: 56.85984844,
      nNavires: 34,
      nTankers: 17,
      nCargos: 17,
      date: "2026-07-05",
    });
  });

  it("traduit les grands détroits en français, garde le nom PortWatch sinon", () => {
    const cps = parseChokepoints(refJson, dailyJson);
    expect(cps.map((c) => c.nom)).toEqual([
      "Canal de Suez",
      "Bab-el-Mandeb",
      "Détroit d'Ormuz",
      "Cape of Good Hope", // hors liste des grands détroits → nom source conservé
    ]);
  });

  it("chokepoint7 : dernier point disponible = 2026-07-04 (pas de ligne au 07-05)", () => {
    const cap = parseChokepoints(refJson, dailyJson).find((c) => c.id === "chokepoint7");
    expect(cap?.date).toBe("2026-07-04");
    expect(cap?.nTankers).toBe(11);
    expect(cap?.nNavires).toBe(68);
  });

  it("chokepoint sans donnée journalière → compteurs et date à null", () => {
    const cps = parseChokepoints(refJson, { features: [] });
    expect(cps).toHaveLength(4);
    expect(cps[0]).toMatchObject({ nNavires: null, nTankers: null, nCargos: null, date: null });
  });

  it("tolère les réponses non conformes (dégradation → [])", () => {
    expect(parseChokepoints(null, null)).toEqual([]);
    expect(parseChokepoints({ error: { code: 400 } }, dailyJson)).toEqual([]);
    expect(parseChokepoints("html d'erreur", 42)).toEqual([]);
  });

  it("ignore une ligne de référence sans lat/lon exploitables", () => {
    const refCasse = {
      features: [
        { attributes: { portid: "chokepoint9", portname: "Dover Strait", lat: "n/a", lon: null } },
        { attributes: { portid: "chokepoint1", portname: "Suez Canal", lat: 30.59334599, lon: 32.43688221 } },
      ],
    };
    const cps = parseChokepoints(refCasse, dailyJson);
    expect(cps.map((c) => c.id)).toEqual(["chokepoint1"]);
  });

  it("tolère un champ date en epoch ms (anciens types date Esri)", () => {
    const daily = {
      features: [
        { attributes: { date: Date.UTC(2026, 6, 5), portid: "chokepoint1", n_tanker: 20, n_cargo: 26, n_total: 46 } },
      ],
    };
    const suez = parseChokepoints(refJson, daily).find((c) => c.id === "chokepoint1");
    expect(suez?.date).toBe("2026-07-05");
  });
});
