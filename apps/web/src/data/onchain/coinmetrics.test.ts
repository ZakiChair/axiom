import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

function stockage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

describe("chargerLignesCoinMetrics : actif et début paramétrables", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", stockage());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("demande l'actif et la date de début passés en option", async () => {
    const { chargerLignesCoinMetrics } = await import("./coinmetrics");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ asset: "eth", time: "2026-09-13T00:00:00Z" }] }));
    vi.stubGlobal("fetch", fetcher);
    const lignes = await chargerLignesCoinMetrics(["FlowInExNtv"], undefined, { asset: "eth", debut: "2024-07-01" });
    expect(lignes).toHaveLength(1);
    const url = String(fetcher.mock.calls[0]?.[0]);
    expect(url).toContain("assets=eth");
    expect(url).toContain("start_time=2024-07-01");
    expect(url).toContain("page_size=10000");
  });

  it("conserve BTC depuis 2010 par défaut", async () => {
    const { chargerLignesCoinMetrics } = await import("./coinmetrics");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetcher);
    await chargerLignesCoinMetrics(["PriceUSD"]);
    const url = String(fetcher.mock.calls[0]?.[0]);
    expect(url).toContain("assets=btc");
    expect(url).toContain("start_time=2010-07-01");
  });
});
