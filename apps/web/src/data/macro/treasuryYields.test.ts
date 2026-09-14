import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chargerRendementsUS,
  deltaJour,
  parseEcbObsValue,
  parseTreasuryYieldCurveCsv,
  spread2s10s,
} from "./treasuryYields";

// Extrait RÉEL (home.treasury.gov, 2026) — ligne récente en tête.
const CSV_US = `Date,"1 Mo","1.5 Month","2 Mo","3 Mo","4 Mo","6 Mo","1 Yr","2 Yr","3 Yr","5 Yr","7 Yr","10 Yr","20 Yr","30 Yr"
07/02/2026,3.70,3.73,3.81,3.82,3.91,3.98,3.96,4.14,4.16,4.23,4.35,4.49,4.99,4.98
07/01/2026,3.67,3.71,3.72,3.85,3.95,4.00,4.00,4.17,4.19,4.24,4.35,4.48,4.97,4.97
06/30/2026,3.70,3.74,3.77,3.87,3.92,4.01,3.98,4.14,4.15,4.19,4.30,4.44,4.93,4.91`;

describe("parseTreasuryYieldCurveCsv", () => {
  it("parse les observations dans l'ordre source (récente en tête)", () => {
    const rows = parseTreasuryYieldCurveCsv(CSV_US);
    expect(rows.length).toBe(3);
    expect(rows[0]!.date).toBe("07/02/2026");
    expect(rows[0]!.rendements["2 Yr"]).toBe(4.14);
    expect(rows[0]!.rendements["10 Yr"]).toBe(4.49);
    expect(rows[0]!.rendements["30 Yr"]).toBe(4.98);
  });

  it("indexe toutes les maturités de l'en-tête", () => {
    const rows = parseTreasuryYieldCurveCsv(CSV_US);
    expect(rows[0]!.rendements["1 Mo"]).toBe(3.7);
    expect(rows[0]!.rendements["3 Mo"]).toBe(3.82);
  });

  it("omet les cellules non numériques sans injecter de NaN", () => {
    const csv = `Date,"2 Yr","10 Yr"\n07/02/2026,4.14,N/A\n07/01/2026,,4.48`;
    const rows = parseTreasuryYieldCurveCsv(csv);
    expect(rows[0]!.rendements["10 Yr"]).toBeUndefined();
    expect(rows[0]!.rendements["2 Yr"]).toBe(4.14);
    expect(rows[1]!.rendements["2 Yr"]).toBeUndefined();
    expect(rows[1]!.rendements["10 Yr"]).toBe(4.48);
  });

  it("entrée vide / sans colonne Date → [] (dégradation gracieuse)", () => {
    expect(parseTreasuryYieldCurveCsv("")).toEqual([]);
    expect(parseTreasuryYieldCurveCsv("Foo,Bar\n1,2")).toEqual([]);
  });
});

describe("deltaJour", () => {
  it("calcule la variation jour-sur-jour (récent − précédent)", () => {
    const rows = parseTreasuryYieldCurveCsv(CSV_US);
    // 10 Yr : 4.49 − 4.48 = +0.01
    expect(deltaJour(rows, "10 Yr")).toBeCloseTo(0.01, 6);
    // 30 Yr : 4.98 − 4.97 = +0.01
    expect(deltaJour(rows, "30 Yr")).toBeCloseTo(0.01, 6);
  });
  it("historique trop court ou maturité absente → null", () => {
    expect(deltaJour([], "10 Yr")).toBeNull();
    const rows = parseTreasuryYieldCurveCsv(CSV_US);
    expect(deltaJour(rows, "50 Yr")).toBeNull();
  });
});

describe("spread2s10s", () => {
  it("calcule 10 Yr − 2 Yr sur la dernière observation", () => {
    const rows = parseTreasuryYieldCurveCsv(CSV_US);
    // 4.49 − 4.14 = 0.35
    expect(spread2s10s(rows)).toBeCloseTo(0.35, 6);
  });
  it("[] → null", () => {
    expect(spread2s10s([])).toBeNull();
  });
});

describe("parseEcbObsValue", () => {
  // Extrait RÉEL (data-api.ecb.europa.eu, format=csvdata) — en-têtes + 1 observation.
  const CSV_ECB = `KEY,FREQ,REF_AREA,CURRENCY,PROVIDER_FM,INSTRUMENT_FM,PROVIDER_FM_ID,DATA_TYPE_FM,TIME_PERIOD,OBS_VALUE,OBS_STATUS,OBS_CONF,TITLE,UNIT,UNIT_MULT
YC.B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y,B,U2,EUR,4F,G_N_A,SV_C_YM,SR_10Y,2026-07-02,2.9878649255,A,F,AAA yield curve - 10-year spot rate,PCPA,0`;

  it("extrait la colonne OBS_VALUE", () => {
    expect(parseEcbObsValue(CSV_ECB)).toBeCloseTo(2.9878649255, 6);
  });
  it("CSV sans observation → null", () => {
    expect(parseEcbObsValue("KEY,OBS_VALUE")).toBeNull();
    expect(parseEcbObsValue("")).toBeNull();
  });
  it("OBS_VALUE non numérique → null", () => {
    expect(parseEcbObsValue("KEY,OBS_VALUE\nx,NA")).toBeNull();
  });
});

describe("chargerRendementsUS", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    // Midi UTC le 2 janvier : même année civile dans tous les fuseaux usuels.
    vi.setSystemTime(new Date("2027-01-02T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("année courante non vide : une seule requête, sur l'année courante", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => CSV_US });
    const rows = await chargerRendementsUS();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/2027/all");
    expect(rows).toEqual(parseTreasuryYieldCurveCsv(CSV_US));
  });

  it("CSV de l'année courante en HTTP 200 vide (janvier) : repli sur l'année N−1", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, text: async () => "" })
      .mockResolvedValueOnce({ ok: true, text: async () => CSV_US });
    const rows = await chargerRendementsUS();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]![0])).toContain("/2026/all");
    expect(String(fetchMock.mock.calls[1]![0])).toContain("field_tdr_date_value=2026");
    expect(rows).toEqual(parseTreasuryYieldCurveCsv(CSV_US));
  });

  it("panne HTTP de l'année courante : [] sans seconde requête", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, text: async () => "" });
    expect(await chargerRendementsUS()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("repli N−1 lui-même en panne : []", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, text: async () => "" })
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => "" });
    expect(await chargerRendementsUS()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fetch rejeté : []", async () => {
    fetchMock.mockRejectedValue(new Error("réseau"));
    expect(await chargerRendementsUS()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
