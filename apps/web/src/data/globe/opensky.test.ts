import { describe, expect, it } from "vitest";
import { INTERVALLE_POLL_MS, parseCreditsRestants, parseEtatsOpenSky } from "./opensky";

// FIXTURE RÉELLE — extrait verbatim d'une réponse /api/states/all refetchée en direct
// le 2026-07-10 (bbox France, en-tête x-rate-limit-remaining: 382 observé). Indices
// positionnels : 0 icao24, 5 lon, 6 lat, 7 baro_alt, 8 on_ground, 10 true_track, 13 geo_alt.
const reponseReelle = {
  time: 1783728000,
  states: [
    ["396668", "FPO701  ", "France", 1783727999, 1783728000, 3.0361, 47.5695, 9456.42, false, 223.7, 167.79, -0.33, null, 9898.38, "1000", false, 0],
    ["440732", "EJU4372 ", "Austria", 1783728000, 1783728000, 4.8594, 44.9436, 7299.96, false, 220.62, 3.61, -13.33, null, 7719.06, "1000", false, 0],
    ["3c542f", "BCS465  ", "Germany", 1783728000, 1783728000, 4.8417, 47.5984, 10370.82, false, 233.59, 316.25, 0, null, 10866.12, "5763", false, 0],
  ],
};

describe("parseEtatsOpenSky", () => {
  it("mappe les indices positionnels du tableau states vers Avion", () => {
    const etat = parseEtatsOpenSky(reponseReelle, 382);
    expect(etat).not.toBeNull();
    expect(etat?.horodatage).toBe(1783728000);
    expect(etat?.creditsRestants).toBe(382);
    expect(etat?.avions).toHaveLength(3);
    expect(etat?.avions[0]).toEqual({
      icao24: "396668",
      lat: 47.5695,
      lon: 3.0361,
      cap: 167.79,
      altitude: 9898.38, // geo_altitude (indice 13) prioritaire
      auSol: false,
    });
  });

  it("filtre les aéronefs sans position (lat/lon null)", () => {
    const json = {
      time: 1783728000,
      states: [
        // Vecteur réel sans position — cas fréquent (aéronef vu sans fix récent).
        ["4b1817", "SWR52T  ", "Switzerland", null, 1783728000, null, null, null, false, null, null, null, null, null, "2000", false, 0],
        ...reponseReelle.states,
      ],
    };
    const etat = parseEtatsOpenSky(json, null);
    expect(etat?.avions.map((a) => a.icao24)).toEqual(["396668", "440732", "3c542f"]);
  });

  it("replie l'altitude sur baro_altitude (indice 7) si geo_altitude est null", () => {
    const json = {
      time: 1783728000,
      states: [
        ["abc123", null, "France", null, 1783728000, 2.55, 49.01, 3200.4, false, 120, 90.0, 0, null, null, null, false, 0],
      ],
    };
    expect(parseEtatsOpenSky(json, null)?.avions[0]?.altitude).toBe(3200.4);
  });

  it("cap et altitude null tolérés, aéronef au sol détecté", () => {
    const json = {
      time: 1783728000,
      states: [
        ["def456", null, "France", null, 1783728000, 2.55, 49.01, null, true, 5.1, null, null, null, null, null, false, 0],
      ],
    };
    const avion = parseEtatsOpenSky(json, null)?.avions[0];
    expect(avion).toEqual({ icao24: "def456", lat: 49.01, lon: 2.55, cap: null, altitude: null, auSol: true });
  });

  it("states null/absent → 0 avion mais état valide (nuit creuse possible)", () => {
    expect(parseEtatsOpenSky({ time: 1783728000, states: null }, null)?.avions).toEqual([]);
  });

  it("réponse sans horodatage exploitable → null (dégradation gracieuse)", () => {
    expect(parseEtatsOpenSky(null, null)).toBeNull();
    expect(parseEtatsOpenSky({ states: [] }, null)).toBeNull();
    expect(parseEtatsOpenSky("erreur html", 10)).toBeNull();
  });
});

describe("parseCreditsRestants", () => {
  it("parse l'en-tête x-rate-limit-remaining", () => {
    expect(parseCreditsRestants("382")).toBe(382);
    expect(parseCreditsRestants("0")).toBe(0);
  });
  it("null si absent (cas daemon PROD qui absorbe l'en-tête) ou invalide", () => {
    expect(parseCreditsRestants(null)).toBeNull();
    expect(parseCreditsRestants("n/a")).toBeNull();
    expect(parseCreditsRestants("-3")).toBeNull();
  });
});

describe("INTERVALLE_POLL_MS", () => {
  it("120 s — aligné sur le TTL /extapi par défaut et le budget 400 crédits/jour", () => {
    expect(INTERVALLE_POLL_MS).toBe(120_000);
  });
});
