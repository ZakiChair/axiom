import { afterEach, describe, expect, it, vi } from "vitest";
import { chargerSerieMospi, parseSerieMospi } from "./mospi";

const ligne = { frequency: "Monthly", indicator: "UR (Unemployment Rate, in per cent)", year: "2026", month: "July", state: "All India", AgeGroup: "15 years and above", gender: "person", sector: "rural + urban", value: "5.1", unit: "%" };
const reponse = (data: unknown[], page = 1, totalPages = 1) => ({ statusCode: true, data, meta_data: { page, totalPages, totalRecords: 2, recordPerPage: 200 } });
afterEach(() => { vi.unstubAllGlobals(); });

describe("MoSPI PLFS mensuel national", () => {
  it("ne mélange ni âge, ni genre, ni secteur, ni fréquence avec le chômage national", () => {
    const data = [ligne, { ...ligne, value: "99", gender: "female" }, { ...ligne, value: "99", sector: "urban" }, { ...ligne, value: "99", AgeGroup: "15-29 years" }, { ...ligne, value: "99", frequency: "Quarterly" }, { ...ligne, value: "99", state: "Delhi" }, { ...ligne, value: "99", indicator: "LFPR" }];
    expect(parseSerieMospi(reponse(data))).toEqual([{ time: Date.UTC(2026, 6, 1), value: 5.1 }]);
  });
  it("trie les vrais mois, préserve zéro et ignore blancs ou périodes invalides", () => {
    expect(parseSerieMospi(reponse([ligne, { ...ligne, month: "June", value: "0" }, { ...ligne, month: "May", value: " " }, { ...ligne, month: "April", value: null }, { ...ligne, year: "2025-26" }, { ...ligne, month: "Autre" }]))).toEqual([{ time: Date.UTC(2026, 5, 1), value: 0 }, { time: Date.UTC(2026, 6, 1), value: 5.1 }]);
  });
  it("refuse une réponse en erreur et des doublons contradictoires", () => {
    expect(() => parseSerieMospi({ statusCode: false, data: [] })).toThrow();
    expect(() => parseSerieMospi(reponse([ligne, { ...ligne, value: "5.9" }]))).toThrow();
    expect(parseSerieMospi(reponse([ligne, ligne]))).toHaveLength(1);
  });
  it("parcourt les pages sans le filtre year_type_code qui tronque l'historique amont", async () => {
    const appels = vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes("page=2") ? reponse([ligne], 2, 2) : reponse([{ ...ligne, month: "June", value: "5.5" }], 1, 2) }));
    vi.stubGlobal("fetch", appels);
    const signal = new AbortController().signal;
    expect(await chargerSerieMospi("chomage", Date.UTC(2026, 0, 1), signal)).toEqual([{ time: Date.UTC(2026, 5, 1), value: 5.5 }, { time: Date.UTC(2026, 6, 1), value: 5.1 }]);
    expect(appels).toHaveBeenCalledTimes(2);
    const url = new URL(appels.mock.calls[0]![0], "http://localhost");
    expect(url.pathname).toBe("/extapi/api.mospi.gov.in/api/plfs/getData");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ indicator_code: "3", frequency_code: "3", state_code: "99", gender_code: "3", sector_code: "3", age_code: "1", limit: "200", Format: "JSON" });
    expect(url.searchParams.has("year_type_code")).toBe(false);
  });
  it("interrompt une pagination abusive et ne fait pas de requête après annulation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => reponse([ligne], 1, 100000) })));
    await expect(chargerSerieMospi("chomage", 0)).rejects.toThrow();
    const ctrl = new AbortController(); ctrl.abort();
    const appel = vi.fn(); vi.stubGlobal("fetch", appel);
    await expect(chargerSerieMospi("chomage", 0, ctrl.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(appel).not.toHaveBeenCalled();
  });
});
