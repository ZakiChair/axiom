import { afterEach, describe, expect, it, vi } from "vitest";
import { chargerSerieStatcan, parseStatcanSeries } from "./statcan";
import { variationPeriode } from "./harmonisation";

const VECTOR = 1230995983;
// Structure WDS réellement obtenue le 07/09/2026, table 18-10-0265-01.
function observation(refPer: string, value: unknown, autres: Record<string, unknown> = {}) {
  return { refPer, refPer2: "", refPerRaw: refPer, refPerRaw2: "", value, decimals: 1,
    scalarFactorCode: 0, symbolCode: 0, statusCode: 0, securityLevelCode: 0,
    releaseTime: "2026-08-20T08:30", frequencyCode: 6, ...autres };
}
function reponse(points: ReturnType<typeof observation>[]) {
  return [{ status: "SUCCESS", object: { responseStatusCode: 0, productId: 18100265,
    coordinate: "1.1.0.0.0.0.0.0.0.0", vectorId: VECTOR, vectorDataPoint: points } }];
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("IPPI StatCan", () => {
  it("lit l'indice national en unités et date la période, pas la publication", () => {
    const raw = reponse([observation("2026-07-01", 146.5), observation("2025-07-01", 130.3)]);
    expect(parseStatcanSeries(raw, VECTOR, Date.UTC(2026, 0, 1))).toEqual([
      { time: Date.UTC(2026, 6, 1), value: 146.5 },
    ]);
  });
  it("calcule l'a/a sur le mois exact malgré les trous, jamais le douzième point", () => {
    const raw = reponse([observation("2025-06-01", 125), observation("2026-06-01", 150), observation("2026-07-01", 146.5)]);
    expect(variationPeriode(parseStatcanSeries(raw, VECTOR, 0), 12)).toEqual([
      { time: Date.UTC(2026, 5, 1), value: 20 },
    ]);
  });
  it("rejette les absences, valeurs confidentielles et périodes invalides sans fabriquer de zéro", () => {
    const raw = reponse([observation("2026-01-01", null), observation("2026-02-01", ""),
      observation("2026-03-01", true), observation("2026-04-01", 123, { statusCode: 8 }),
      observation("2026-05-01", 124, { securityLevelCode: 1 }), observation("2026-13-01", 125),
      observation("2026-07-02", 126), observation("2026-08-01", 127, { frequencyCode: 9 })]);
    expect(parseStatcanSeries(raw, VECTOR, 0)).toEqual([]);
  });
  it("conserve les drapeaux provisoire, révisé et prudence", () => {
    expect(parseStatcanSeries(reponse([observation("2026-07-01", 146.5, { symbolCode: 1, statusCode: 7 })]), VECTOR, 0))
      .toEqual([{ time: Date.UTC(2026, 6, 1), value: 146.5, qualite: "provisoire ; utiliser avec prudence" }]);
    expect(parseStatcanSeries(reponse([observation("2026-06-01", 144, { symbolCode: 3 })]), VECTOR, 0)[0]?.qualite).toBe("révisé");
  });
  it("refuse une mauvaise série, un échec WDS ou une échelle différente", () => {
    const mauvais = reponse([]); mauvais[0]!.object.vectorId = 1;
    expect(() => parseStatcanSeries(mauvais, VECTOR, 0)).toThrow();
    expect(() => parseStatcanSeries([{ status: "FAILED" }], VECTOR, 0)).toThrow();
    expect(() => parseStatcanSeries(reponse([observation("2026-07-01", 146.5, { scalarFactorCode: 3 })]), VECTOR, 0)).toThrow();
  });
  it("ne sélectionne pas arbitrairement un mois dupliqué contradictoire", () => {
    expect(() => parseStatcanSeries(reponse([observation("2026-07-01", 146.5), observation("2026-07-01", 147)]), VECTOR, 0)).toThrow();
  });
  it("charge le GET CORS borné et conserve le signal d'annulation", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-07T12:00:00Z"));
    const signal = new AbortController().signal;
    const fetcher = vi.fn(async () => new Response(JSON.stringify(reponse([observation("2026-07-01", 146.5)]))));
    vi.stubGlobal("fetch", fetcher);
    expect(await chargerSerieStatcan(VECTOR, Date.UTC(2025, 6, 1), signal)).toEqual([{ time: Date.UTC(2026, 6, 1), value: 146.5 }]);
    const [url, opts] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://www150.statcan.gc.ca/t1/wds/rest/getDataFromVectorByReferencePeriodRange");
    expect(Object.fromEntries(u.searchParams)).toEqual({ vectorIds: "1230995983", startRefPeriod: "2025-07-01", endReferencePeriod: "2026-09-07" });
    expect(opts.signal).toBe(signal);
  });
  it("signale une réponse HTTP en panne", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("indisponible", { status: 503 })));
    await expect(chargerSerieStatcan(VECTOR, 0)).rejects.toThrow("503");
  });
});
