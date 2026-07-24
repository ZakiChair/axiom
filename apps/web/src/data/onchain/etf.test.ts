import { describe, expect, it } from "vitest";
import { healthStore } from "../../store/health";
import { parseEtfFlows, rapporterSanteEtf } from "./etf";

// Schéma RÉEL confirmé par curl direct (2026-07-08) sur
// POST https://openapi.sosovalue.com/openapi/v2/etf/currentEtfDataMetrics
// avec { type: "us-btc-spot" | "us-eth-spot" | "us-sol-spot" } — voir en-tête de etf.ts.
describe("parseEtfFlows (schéma réel SoSoValue currentEtfDataMetrics)", () => {
  it("parse une réponse valide", () => {
    const json = {
      code: 0,
      msg: null,
      traceId: null,
      data: {
        totalNetAssets: { value: "77259139787.999919722", lastUpdateDate: "2026-07-07", status: "1" },
        dailyNetInflow: { value: "21435004.25", lastUpdateDate: "2026-07-07", status: "1" },
        list: [
          {
            id: 1746110179689463810,
            ticker: "IBIT",
            institute: "BlackRock ",
            dailyNetInflow: { value: "54799040.0000000000000000", lastUpdateDate: "2026-07-07", status: "1" },
          },
          {
            id: 1746110179697852417,
            ticker: "FBTC",
            institute: "Fidelity",
            dailyNetInflow: { value: "-24919910.5499999970000000", lastUpdateDate: "2026-07-07", status: "1" },
          },
        ],
      },
    };
    const r = parseEtfFlows(json);
    expect(r.disponible).toBe(true);
    expect(r.parEmetteur?.[0]).toEqual({ emetteur: "IBIT", flux: 54_799_040 });
    expect(r.parEmetteur?.[1]?.emetteur).toBe("FBTC");
    expect(r.parEmetteur?.[1]?.flux).toBeCloseTo(-24_919_910.55);
    expect(r.total).toBeCloseTo(29_879_129.45);
    expect(r.jour).toBe("2026-07-07");
  });

  it("dégrade proprement sur forme inconnue", () => {
    expect(parseEtfFlows(null).disponible).toBe(false);
    expect(parseEtfFlows({}).disponible).toBe(false);
    expect(parseEtfFlows({ data: { list: [] } }).disponible).toBe(false);
    expect(parseEtfFlows({ data: {} }).disponible).toBe(false);
    // code d'erreur SoSoValue (ex. clé invalide) : pas de `data.list` exploitable.
    expect(parseEtfFlows({ code: 401, msg: "invalid api key", data: null }).disponible).toBe(false);
  });

  it("trie les émetteurs par |flux du jour| décroissant (départage par ticker)", () => {
    // Ordre d'entrée VOLONTAIREMENT différent de l'ordre attendu : GBTC arrive en tête
    // du payload mais a le plus petit |flux| ; ARKB (sortie −80M) doit passer devant IBIT
    // (+50M) car |−80M| > |+50M|. Deux ex æquo (±10M) départagés par ticker : BITB < HODL.
    const json = {
      data: {
        dailyNetInflow: { value: "0", lastUpdateDate: "2026-07-07" },
        list: [
          { ticker: "GBTC", dailyNetInflow: { value: "5000000" } },
          { ticker: "IBIT", dailyNetInflow: { value: "50000000" } },
          { ticker: "HODL", dailyNetInflow: { value: "-10000000" } },
          { ticker: "ARKB", dailyNetInflow: { value: "-80000000" } },
          { ticker: "BITB", dailyNetInflow: { value: "10000000" } },
        ],
      },
    };
    const r = parseEtfFlows(json);
    expect(r.parEmetteur?.map((e) => e.emetteur)).toEqual(["ARKB", "IBIT", "BITB", "HODL", "GBTC"]);
  });

  it("ignore les entrées de la liste sans ticker ou avec netInflow non numérique", () => {
    const json = {
      data: {
        dailyNetInflow: { value: "1", lastUpdateDate: "2026-07-07" },
        list: [
          { ticker: "IBIT", dailyNetInflow: { value: "100" } },
          { ticker: "BOGUS", dailyNetInflow: { value: "not-a-number" } },
          { dailyNetInflow: { value: "200" } }, // pas de ticker
        ],
      },
    };
    const r = parseEtfFlows(json);
    expect(r.disponible).toBe(true);
    expect(r.parEmetteur).toEqual([{ emetteur: "IBIT", flux: 100 }]);
    expect(r.total).toBe(100);
  });
});

describe("rapporterSanteEtf (agrégation d'un cycle btc/eth/sol)", () => {
  it("au moins un actif disponible → polling (peu importe l'ordre des échecs)", () => {
    rapporterSanteEtf([
      { disponible: false, raison: "SoSoValue indisponible (HTTP 429)." },
      { disponible: true, parEmetteur: [{ emetteur: "IBIT", flux: 1 }], total: 1 },
      { disponible: false, raison: "SoSoValue injoignable." },
    ]);
    expect(healthStore.getState().sources["sosovalue"]?.etat).toBe("polling");
  });

  it("tous en échec → erreur avec la première raison", () => {
    rapporterSanteEtf([
      { disponible: false, raison: "SoSoValue injoignable." },
      { disponible: false, raison: "SoSoValue indisponible (HTTP 500)." },
    ]);
    const sante = healthStore.getState().sources["sosovalue"];
    expect(sante?.etat).toBe("error");
    expect(sante?.derniereErreur).toBe("SoSoValue injoignable.");
  });

  it("cycle vide → aucune écriture (pas d'état fantôme)", () => {
    healthStore.getState().retirer("sosovalue");
    rapporterSanteEtf([]);
    expect(healthStore.getState().sources["sosovalue"]).toBeUndefined();
  });
});
