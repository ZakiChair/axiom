import { afterEach, describe, expect, it, vi } from "vitest";
import { chargerSerieBoj, parseBojSeries } from "./boj";

const CODE = "PRCG20_2200000000%";
// Extrait du GET officiel du 07/09/2026 : a/a déjà calculé par la BOJ.
function reponse(dates: unknown[] = [202606, 202607], valeurs: unknown[] = [7.3, 7.2]) {
  return { STATUS: 200, MESSAGEID: "M181000I", MESSAGE: "Successfully completed",
    DATE: "2026-09-07T21:17:14.585+09:00", PARAMETER: { FORMAT: "JSON", LANG: "EN", DB: "PR01" },
    NEXTPOSITION: null, RESULTSET: [{ SERIES_CODE: CODE,
      NAME_OF_TIME_SERIES: "[Producer Price Index] All commodities (Year-on-year change)",
      UNIT: "%", FREQUENCY: "MONTHLY", CATEGORY: "Corporate Goods Price Index (2020 Base)/ Producer Price Index",
      LAST_UPDATE: 20260813, VALUES: { SURVEY_DATES: dates, VALUES: valeurs } }] };
}
afterEach(() => vi.unstubAllGlobals());

describe("PPI BOJ", () => {
  it("conserve le taux a/a natif et la période mensuelle, pas LAST_UPDATE", () => {
    expect(parseBojSeries(reponse(), CODE, Date.UTC(2026, 6, 1))).toEqual([{ time: Date.UTC(2026, 6, 1), value: 7.2 }]);
  });
  it("aligne les tableaux avant d'écarter null et accepte zéro ou déflation", () => {
    expect(parseBojSeries(reponse([202601, 202602, 202603, 202604, 202605, 202606, 202613], [null, -1.2, 0, "", true, 7.3, 8]), CODE, 0))
      .toEqual([{ time: Date.UTC(2026, 1, 1), value: -1.2 }, { time: Date.UTC(2026, 2, 1), value: 0 }, { time: Date.UTC(2026, 5, 1), value: 7.3 }]);
  });
  it("refuse un indice, une autre série ou fréquence et une pagination inattendue", () => {
    const raw = reponse(); raw.RESULTSET[0]!.UNIT = "CY2020 average=100";
    expect(() => parseBojSeries(raw, CODE, 0)).toThrow();
    expect(() => parseBojSeries(reponse(), "autre", 0)).toThrow();
    const annuel = reponse(); annuel.RESULTSET[0]!.FREQUENCY = "ANNUAL";
    expect(() => parseBojSeries(annuel, CODE, 0)).toThrow();
    expect(() => parseBojSeries({ ...reponse(), NEXTPOSITION: 2 }, CODE, 0)).toThrow();
  });
  it("refuse les tableaux désalignés et les mois contradictoires", () => {
    expect(() => parseBojSeries(reponse([202606, 202607], [7.3]), CODE, 0)).toThrow();
    expect(() => parseBojSeries(reponse([202607, 202607], [7.3, 7.2]), CODE, 0)).toThrow();
  });
  it("refuse un statut d'erreur dans un JSON HTTP200", () => {
    expect(() => parseBojSeries({ ...reponse(), STATUS: 400 }, CODE, 0)).toThrow();
  });
  it("charge via extapi et encode le pourcent du code sans confondre taux et indice", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(reponse())));
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    expect(await chargerSerieBoj(CODE, Date.UTC(2026, 6, 1), signal)).toEqual([{ time: Date.UTC(2026, 6, 1), value: 7.2 }]);
    const [url, opts] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const u = new URL(url, "https://axiom.local");
    expect(u.pathname).toBe("/extapi/www.stat-search.boj.or.jp/api/v1/getDataCode");
    expect(Object.fromEntries(u.searchParams)).toEqual({ format: "json", lang: "en", db: "PR01", code: CODE, startDate: "202607" });
    expect(opts.signal).toBe(signal);
  });
  it("signale une erreur HTTP amont", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("quota", { status: 429 })));
    await expect(chargerSerieBoj(CODE, 0)).rejects.toThrow("429");
  });
});
