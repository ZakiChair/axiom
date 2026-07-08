import { describe, expect, it } from "vitest";
import { parseEtfFlows } from "./etf";

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
