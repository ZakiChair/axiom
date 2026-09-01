import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLE_CACHE_CCDATA,
  ErreurCcData,
  chargerHistoriqueCcData,
  fetchHistoriqueCcData,
  normaliserPointsCcData,
  snapshotsCcData,
} from "./ccdataMcap";

const JOUR_S = 86_400;
const T0_S = Date.UTC(2020, 0, 1) / 1000;

function brut(timestamp: number, total: number, btc = 40, eth = 20) {
  return {
    TIMESTAMP: timestamp,
    MKT_CAP_USD: total,
    DOMINANCE_BTC: btc,
    DOMINANCE_ETH: eth,
    VOLUME_USD: total / 10,
  };
}

function reponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installMockLocalStorage(): void {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    clear: () => data.clear(),
    key: (index) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  };
}

beforeEach(() => {
  installMockLocalStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe("normaliserPointsCcData", () => {
  it("normalise, trie, dédoublonne et conserve les dominances", () => {
    const points = normaliserPointsCcData([
      brut(T0_S + JOUR_S, 1_100, 41, 19),
      brut(T0_S, 1_000, 40, 20),
      brut(T0_S + JOUR_S + 3_600, 1_200, 42, 18),
      brut(T0_S + 2 * JOUR_S, -1),
    ]);

    expect(points).toEqual([
      { t: T0_S * 1000, total: 1_000, dominanceBtc: 40, dominanceEth: 20 },
      { t: (T0_S + JOUR_S) * 1000, total: 1_200, dominanceBtc: 42, dominanceEth: 18 },
    ]);
  });

  it("dérive TOTAL2 et TOTAL3 sans inventer une dominance manquante", () => {
    const points = normaliserPointsCcData([
      brut(T0_S, 1_000, 40, 20),
      { ...brut(T0_S + JOUR_S, 1_200), DOMINANCE_ETH: null },
    ]);
    const snapshots = snapshotsCcData(points);

    expect(snapshots[0]).toEqual({ t: T0_S * 1000, total: 1_000, total2: 600, total3: 400 });
    expect(snapshots[1]?.total2).toBe(720);
    expect(snapshots[1]?.total3).toBeNaN();
  });
});

describe("fetchHistoriqueCcData", () => {
  it("pagine vers le passé, garde la clé hors URL et utilise l'en-tête Authorization", async () => {
    const pages = [
      [brut(T0_S + 2 * JOUR_S, 1_200), brut(T0_S + 3 * JOUR_S, 1_300)],
      [brut(T0_S, 1_000), brut(T0_S + JOUR_S, 1_100)],
      [],
    ];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      reponse({ Data: pages.shift() ?? [] }),
    );

    const points = await fetchHistoriqueCcData("secrète&1", {
      fetcher: fetcher as typeof fetch,
      pageLimit: 2,
      maxPages: 5,
    });

    expect(points.map((point) => point.total)).toEqual([1_000, 1_100, 1_200, 1_300]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(String(fetcher.mock.calls[0]?.[0])).toMatch(/^\/ccdataapi\//);
    expect(String(fetcher.mock.calls[0]?.[0])).not.toContain("secrète");
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Apikey secrète&1");
    expect(new URL(String(fetcher.mock.calls[1]?.[0]), "http://localhost").searchParams.get("to_ts")).toBe(
      String(T0_S + 2 * JOUR_S - 1),
    );
  });

  it("lève une erreur explicite quand la clé ou le plan est refusé", async () => {
    const fetcher = vi.fn(async () => reponse({ Err: { message: "unauthorized" } }, 401));
    await expect(
      fetchHistoriqueCcData("invalide", { fetcher: fetcher as typeof fetch }),
    ).rejects.toBeInstanceOf(ErreurCcData);
    await expect(
      fetchHistoriqueCcData("invalide", { fetcher: fetcher as typeof fetch }),
    ).rejects.toThrow(/clé|accès/i);
  });
});

describe("chargerHistoriqueCcData", () => {
  it("rend null sans clé ni cache", async () => {
    await expect(chargerHistoriqueCcData({ apiKey: null })).resolves.toBeNull();
  });

  it("ne partage pas une requête en vol entre deux clés différentes", async () => {
    const resolvers: Array<(response: Response) => void> = [];
    const fetcher = vi.fn(
      () => new Promise<Response>((resolve) => void resolvers.push(resolve)),
    );
    vi.stubGlobal("fetch", fetcher);
    localStorage.setItem("axiom:ccdata:key", "clé-a");
    const premier = chargerHistoriqueCcData();
    await Promise.resolve();

    localStorage.setItem("axiom:ccdata:key", "clé-b");
    const second = chargerHistoriqueCcData();
    await Promise.resolve();

    expect(second).not.toBe(premier);
    expect(fetcher).toHaveBeenCalledTimes(2);
    resolvers[1]?.(reponse({ Data: [brut(T0_S, 2_000)] }));
    await expect(second).resolves.toEqual([
      { t: T0_S * 1000, total: 2_000, total2: 1_200, total3: 800 },
    ]);
    resolvers[0]?.(reponse({ Data: [brut(T0_S, 1_000)] }));
    await expect(premier).rejects.toMatchObject({ name: "AbortError" });
    await expect(chargerHistoriqueCcData({ apiKey: null })).resolves.toEqual([
      { t: T0_S * 1000, total: 2_000, total2: 1_200, total3: 800 },
    ]);
  });

  it("persiste l'all-time et le relit ensuite sans clé", async () => {
    const fetcher = vi.fn(async () => reponse({ Data: [brut(T0_S, 1_000)] }));
    const premier = await chargerHistoriqueCcData({
      apiKey: "clé",
      fetcher: fetcher as typeof fetch,
      maintenant: () => T0_S * 1000,
    });

    expect(premier?.[0]).toMatchObject({ total: 1_000, total2: 600, total3: 400 });
    expect(localStorage.getItem(CLE_CACHE_CCDATA)).not.toBeNull();
    await expect(chargerHistoriqueCcData({ apiKey: null })).resolves.toEqual(premier);
  });

  it("neutralise les dominances corrompues relues depuis le cache", async () => {
    localStorage.setItem(
      CLE_CACHE_CCDATA,
      JSON.stringify({
        version: 1,
        majTs: T0_S * 1000,
        points: [{ t: T0_S * 1000, total: 1_000, dominanceBtc: 999, dominanceEth: -1 }],
      }),
    );

    const points = await chargerHistoriqueCcData({ apiKey: null });
    expect(points?.[0]?.total).toBe(1_000);
    expect(points?.[0]?.total2).toBeNaN();
    expect(points?.[0]?.total3).toBeNaN();
  });

  it("actualise seulement la page récente quand le cache est périmé", async () => {
    const initial = vi.fn(async () => reponse({ Data: [brut(T0_S, 1_000)] }));
    await chargerHistoriqueCcData({
      apiKey: "clé",
      fetcher: initial as typeof fetch,
      maintenant: () => T0_S * 1000,
    });

    const refresh = vi.fn(async () => reponse({ Data: [brut(T0_S + JOUR_S, 1_100)] }));
    const points = await chargerHistoriqueCcData({
      apiKey: "clé",
      fetcher: refresh as typeof fetch,
      maintenant: () => (T0_S + 2 * JOUR_S) * 1000,
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(points?.map((point) => point.total)).toEqual([1_000, 1_100]);
  });
});
