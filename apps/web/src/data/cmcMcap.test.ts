import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLE_CACHE_CMC,
  chargerHistoriqueCmc,
  construireSnapshotsCmc,
  fetchHistoriqueCmc,
  fetchPageHistoriqueCmc,
  normaliserEthCmc,
  normaliserGlobalCmc,
} from "./cmcMcap";

const HEURE = 3_600_000;
const JOUR = 86_400_000;
const T0 = Date.UTC(2015, 7, 6);

function globalQuote(t: number, total: number, total2: number, ethDominance = 0) {
  return {
    timestamp: new Date(t).toISOString(),
    btcDominance: 40,
    ethDominance,
    quote: [{ name: "2781", totalMarketCap: total, altcoinMarketCap: total2 }],
  };
}

function reponse(json: unknown, status = 200): Response {
  return new Response(JSON.stringify(json), {
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

beforeEach(() => installMockLocalStorage());

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe("normalisation CoinMarketCap public", () => {
  it("prend altcoinMarketCap comme TOTAL2 et retombe sur BTC.D s'il manque", () => {
    const sansAltcoin = globalQuote(T0 + JOUR, 1_200, 0, 10);
    sansAltcoin.quote[0]!.altcoinMarketCap = null as unknown as number;
    expect(
      normaliserGlobalCmc({
        data: { quotes: [globalQuote(T0, 1_000, 620, 10), sansAltcoin] },
        status: { error_code: "0" },
      }),
    ).toEqual([
      { t: T0, total: 1_000, total2: 620, dominanceEth: 10 },
      { t: T0 + JOUR, total: 1_200, total2: 720, dominanceEth: 10 },
    ]);
  });

  it("préserve les timestamps horaires", () => {
    expect(
      normaliserGlobalCmc({
        data: { quotes: [globalQuote(T0 + 3 * HEURE, 1_000, 600, 10)] },
        status: { error_code: "0" },
      })[0]?.t,
    ).toBe(T0 + 3 * HEURE);
  });

  it("normalise la capitalisation ETH quotidienne", () => {
    expect(
      normaliserEthCmc({
        data: {
          points: [
            { s: String(T0 / 1000), v: [3, 100, 200] },
            { s: String((T0 + JOUR) / 1000), v: [4, 110, 250] },
            { s: String((T0 + 2 * JOUR) / 1000), v: [5, 120, null] },
          ],
        },
        status: { error_code: "0" },
      }),
    ).toEqual(new Map([[T0, 200], [T0 + JOUR, 250]]));
  });

  it("calcule TOTAL3 avec ETH, et TOTAL3=TOTAL2 avant le lancement d'ETH", () => {
    const globaux = [
      { t: T0, total: 1_000, total2: 620, dominanceEth: 0 },
      { t: T0 + JOUR, total: 1_100, total2: 680, dominanceEth: 10 },
    ];
    const eth = new Map([[T0 + JOUR, 120]]);

    expect(construireSnapshotsCmc(globaux, eth)).toEqual([
      { t: T0, total: 1_000, total2: 620, total3: 620 },
      { t: T0 + JOUR, total: 1_100, total2: 680, total3: 560 },
    ]);
  });
});

describe("fetchHistoriqueCmc", () => {
  it("segmente le global sous la limite de 2 200 points et récupère ETH sans clé", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      if (url.pathname.includes("global-metrics")) {
        const start = Number(url.searchParams.get("timeStart")) * 1000;
        const end = Number(url.searchParams.get("timeEnd")) * 1000;
        const quotes = Array.from(
          { length: Math.floor((end - start) / JOUR) + 1 },
          (_, i) => globalQuote(start + i * JOUR, 1_000 + (start - T0) / JOUR + i, 600 + (start - T0) / JOUR + i),
        );
        return reponse({ data: { quotes }, status: { error_code: "0" } });
      }
      return reponse({
        data: {
          points: [
            { s: String((T0 + JOUR) / 1000), v: [3, 100, 120] },
            { s: String((T0 + 2 * JOUR) / 1000), v: [4, 100, 130] },
            { s: String((T0 + 3 * JOUR) / 1000), v: [5, 100, 140] },
          ],
        },
        status: { error_code: "0" },
      });
    });

    const snapshots = await fetchHistoriqueCmc({
      fetcher: fetcher as typeof fetch,
      debut: T0,
      fin: T0 + 3 * JOUR,
      tailleLotPoints: 2,
    });

    const globalCalls = fetcher.mock.calls.filter(([input]) => String(input).includes("global-metrics"));
    expect(globalCalls).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("/extapi/api.coinmarketcap.com/");
    expect(snapshots.map((point) => point.total3)).toEqual([600, 481, 472, 463]);
  });

  it("charge une page 4h et joint les points ETH horaires correspondants", async () => {
    const debut = Date.UTC(2024, 0, 1);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const start = Number(url.searchParams.get("timeStart")) * 1000;
      const end = Number(url.searchParams.get("timeEnd")) * 1000;
      if (url.pathname.includes("global-metrics")) {
        expect(url.searchParams.get("interval")).toBe("4h");
        const quotes = Array.from({ length: Math.floor((end - start) / (4 * HEURE)) + 1 }, (_, i) =>
          globalQuote(start + i * 4 * HEURE, 1_000 + i * 10, 600 + i * 10, 10));
        return reponse({ data: { quotes }, status: { error_code: "0" } });
      }
      expect(url.searchParams.get("interval")).toBe("1h");
      const points = Array.from({ length: Math.floor((end - start) / HEURE) + 1 }, (_, i) => ({
        s: String((start + i * HEURE) / 1000),
        v: [1, 1, 100 + (start - debut) / HEURE + i],
      }));
      return reponse({ data: { points }, status: { error_code: "0" } });
    });

    const snapshots = await fetchPageHistoriqueCmc("4h", {
      endTime: debut + 8 * HEURE,
      limit: 3,
      fetcher: fetcher as typeof fetch,
      tailleLotEthPoints: 3,
    });

    expect(fetcher.mock.calls.filter(([input]) => !String(input).includes("global-metrics"))).toHaveLength(3);
    expect(snapshots.map((point) => point.t)).toEqual([debut, debut + 4 * HEURE, debut + 8 * HEURE]);
    expect(snapshots.map((point) => point.total3)).toEqual([500, 506, 512]);
  });

  it("déduplique deux demandes simultanées pour la même page", async () => {
    const debut = Date.UTC(2024, 0, 1);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return url.includes("global-metrics")
        ? reponse({
            data: { quotes: [globalQuote(debut, 1_000, 600, 10), globalQuote(debut + HEURE, 1_010, 610, 10)] },
            status: { error_code: "0" },
          })
        : reponse({
            data: { points: [
              { s: String(debut / 1000), v: [1, 1, 100] },
              { s: String((debut + HEURE) / 1000), v: [1, 1, 101] },
            ] },
            status: { error_code: "0" },
          });
    });
    vi.stubGlobal("fetch", fetcher);

    const options = { endTime: debut + HEURE, limit: 2 };
    const premier = fetchPageHistoriqueCmc("1h", options);
    const second = fetchPageHistoriqueCmc("1h", options);

    expect(second).toBe(premier);
    await Promise.all([premier, second]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("chargerHistoriqueCmc", () => {
  it("persiste puis réutilise le cache frais", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return url.includes("global-metrics")
        ? reponse({ data: { quotes: [globalQuote(T0, 1_000, 600)] }, status: { error_code: "0" } })
        : reponse({ data: { points: [] }, status: { error_code: "0" } });
    });
    const deps = {
      fetcher: fetcher as typeof fetch,
      debut: T0,
      fin: T0,
      maintenant: () => T0 + JOUR,
    };

    const premier = await chargerHistoriqueCmc(deps);
    expect(premier).toEqual([{ t: T0, total: 1_000, total2: 600, total3: 600 }]);
    expect(localStorage.getItem(CLE_CACHE_CMC)).not.toBeNull();
    fetcher.mockClear();
    await expect(chargerHistoriqueCmc(deps)).resolves.toEqual(premier);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rend null sur panne initiale afin de laisser les replis prendre la main", async () => {
    const fetcher = vi.fn(async () => reponse({ status: { error_code: "500" } }, 500));
    await expect(
      chargerHistoriqueCmc({
        fetcher: fetcher as typeof fetch,
        debut: T0,
        fin: T0,
      }),
    ).resolves.toBeNull();
  });

  it("repart de la fin du cache quand il est plus vieux que la fenêtre de 45 jours", async () => {
    const timeStarts: number[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const debut = Number(url.searchParams.get("timeStart")) * 1000;
      const fin = Number(url.searchParams.get("timeEnd")) * 1000;
      if (url.pathname.includes("global-metrics")) {
        timeStarts.push(debut);
        const quotes = Array.from(
          { length: Math.floor((fin - debut) / JOUR) + 1 },
          (_, i) => globalQuote(debut + i * JOUR, 1_000 + i, 600 + i),
        );
        return reponse({ data: { quotes }, status: { error_code: "0" } });
      }
      return reponse({ data: { points: [] }, status: { error_code: "0" } });
    });

    // Semer un cache dont le dernier point est T0 (écrit par un premier chargement).
    await chargerHistoriqueCmc({
      fetcher: fetcher as typeof fetch,
      debut: T0,
      fin: T0,
      maintenant: () => T0 + JOUR,
    });
    timeStarts.length = 0;

    // 60 jours plus tard : la fenêtre incrémentale doit rejoindre la fin du cache (T0),
    // pas s'arrêter à now − 45 j — sinon les 15 jours intermédiaires sont perdus À VIE
    // (majTs=now rend le cache « frais » et aucun rafraîchissement ne recouvre le trou).
    const now = T0 + 60 * JOUR;
    const points = await chargerHistoriqueCmc({
      fetcher: fetcher as typeof fetch,
      fin: now,
      maintenant: () => now,
    });

    expect(Math.min(...timeStarts)).toBeLessThanOrEqual(T0);
    const temps = (points ?? []).map((point) => point.t);
    for (let t = T0; t <= now; t += JOUR) expect(temps).toContain(t);
  });
});
