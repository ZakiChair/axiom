import { describe, expect, it } from "vitest";
import { parseCoinMetrics } from "./coinmetrics";

describe("parseCoinMetrics", () => {
  // Fixture réaliste : valeurs sous forme de CHAÎNES, dernier jour incomplet (nulls),
  // et une ligne d'un autre asset (eth) à filtrer.
  const json = {
    data: [
      { asset: "btc", time: "2026-06-28T00:00:00.000000000Z", AdrActCnt: "700000", TxCnt: "600000", CapMVRVCur: "1.10" },
      { asset: "btc", time: "2026-06-29T00:00:00.000000000Z", AdrActCnt: "710000", TxCnt: null, CapMVRVCur: "1.12" },
      { asset: "btc", time: "2026-06-30T00:00:00.000000000Z", AdrActCnt: null, TxCnt: null, CapMVRVCur: null },
      { asset: "eth", time: "2026-06-29T00:00:00.000000000Z", AdrActCnt: "900000" },
    ],
  };
  const metriques = ["AdrActCnt", "TxCnt", "CapMVRVCur"];

  it("ignore les valeurs nulles et le dernier jour incomplet", () => {
    const res = parseCoinMetrics(json, "btc", metriques);
    expect(res["AdrActCnt"]?.points.map((p) => p.value)).toEqual([700000, 710000]);
    expect(res["AdrActCnt"]?.dernier?.value).toBe(710000);
    expect(res["TxCnt"]?.points.map((p) => p.value)).toEqual([600000]);
    expect(res["TxCnt"]?.dernier?.value).toBe(600000);
  });

  it("filtre par asset (les lignes eth sont exclues du résultat btc)", () => {
    const res = parseCoinMetrics(json, "btc", metriques);
    // 2 points btc valides pour AdrActCnt, la ligne eth n'est pas comptée.
    expect(res["AdrActCnt"]?.points.length).toBe(2);
  });

  it("convertit les chaînes numériques et l'horodatage ISO en ms", () => {
    const res = parseCoinMetrics(json, "btc", metriques);
    expect(res["CapMVRVCur"]?.dernier?.value).toBeCloseTo(1.12, 5);
    expect(res["CapMVRVCur"]?.points[0]?.time).toBe(Date.parse("2026-06-28T00:00:00.000000000Z"));
  });

  it("renvoie des séries vides sur données absentes/malformées", () => {
    expect(parseCoinMetrics(null, "btc", metriques)["AdrActCnt"]?.points).toEqual([]);
    expect(parseCoinMetrics({ data: "nope" }, "btc", metriques)["TxCnt"]?.dernier).toBeUndefined();
  });
});
