/**
 * Activité DEX : volume DEX 24 h (DefiLlama overview) rapporté au volume total 24 h
 * (CoinGecko global). Sonde réelle du 2026-09-14 : 6,76 Md$ pour 63,2 Md$ → 10,7 %.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculerPartDex, parseOverviewDex } from "./volumeDex";

describe("calculerPartDex", () => {
  it("part en pourcentage du volume total", () => {
    expect(calculerPartDex(6.76e9, 63.2e9)).toBeCloseTo(10.696, 2);
  });
  it("total nul, négatif ou absent : null", () => {
    expect(calculerPartDex(1, 0)).toBeNull();
    expect(calculerPartDex(1, -5)).toBeNull();
    expect(calculerPartDex(1, null)).toBeNull();
    expect(calculerPartDex(null, 10)).toBeNull();
  });
});

describe("parseOverviewDex", () => {
  it("lit les totaux, la variation 7 j et garde les 90 derniers points datés", () => {
    const chart = Array.from({ length: 100 }, (_, i) => [1_700_000_000 + i * 86_400, 1e9 + i]);
    const r = parseOverviewDex({ total24h: 6.76e9, total7d: 7.06e10, change_7d: -29.92, totalDataChart: chart });
    expect(r.dex24h).toBe(6.76e9);
    expect(r.dex7d).toBe(7.06e10);
    expect(r.change7dPct).toBe(-29.92);
    expect(r.serie).toHaveLength(90);
    expect(r.serie[0]).toEqual({ time: (1_700_000_000 + 10 * 86_400) * 1000, value: 1e9 + 10 });
    expect(r.serie.at(-1)).toEqual({ time: (1_700_000_000 + 99 * 86_400) * 1000, value: 1e9 + 99 });
  });
  it("champs absents ou non numériques : null, série vide", () => {
    const r = parseOverviewDex({ total24h: "n/a", totalDataChart: "rien" });
    expect(r).toEqual({ dex24h: null, dex7d: null, change7dPct: null, serie: [] });
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

describe("fetchActiviteDex : deux sources, cache 1 h, dégradation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", stockage());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("DefiLlama sans ventilation + CoinGecko global, puis cache", async () => {
    const { fetchActiviteDex } = await import("./volumeDex");
    const fetcher = vi.fn<typeof fetch>(async (entree) => {
      const url = String(entree);
      if (url.includes("api.llama.fi/overview/dexs")) {
        return Response.json({ total24h: 6.76e9, total7d: 7.06e10, change_7d: -29.92, totalDataChart: [[1_700_000_000, 5e9]] });
      }
      return Response.json({ data: { total_volume: { usd: 63.2e9 } } });
    });
    vi.stubGlobal("fetch", fetcher);
    const r = await fetchActiviteDex();
    expect(r?.perime).toBe(false);
    expect(r?.donnee).toEqual({
      dex24h: 6.76e9,
      dex7d: 7.06e10,
      change7dPct: -29.92,
      totalVolume24h: 63.2e9,
      serie: [{ time: 1_700_000_000_000, value: 5e9 }],
    });
    const urls = fetcher.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("excludeTotalDataChartBreakdown=true"))).toBe(true);
    expect(urls.some((u) => u.includes("api.coingecko.com/api/v3/global"))).toBe(true);
    await fetchActiviteDex();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("CoinGecko en échec : le volume DEX reste servi, le total est null", async () => {
    const { fetchActiviteDex } = await import("./volumeDex");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (entree) =>
      String(entree).includes("coingecko")
        ? new Response(null, { status: 429 })
        : Response.json({ total24h: 1e9, total7d: 7e9, change_7d: 1, totalDataChart: [] }),
    ));
    const r = await fetchActiviteDex();
    expect(r?.donnee.dex24h).toBe(1e9);
    expect(r?.donnee.totalVolume24h).toBeNull();
  });

  it("DefiLlama en échec : cache périmé resservi, sinon null", async () => {
    const { fetchActiviteDex } = await import("./volumeDex");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    expect(await fetchActiviteDex()).toBeNull();
    localStorage.setItem(
      "axiom:onchain:dex:activite",
      JSON.stringify({ donnee: { dex24h: 2, dex7d: 3, change7dPct: 0, totalVolume24h: 4, serie: [] }, ts: 0 }),
    );
    const r = await fetchActiviteDex();
    expect(r?.perime).toBe(true);
    expect(r?.donnee.dex24h).toBe(2);
  });
});
