import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchMarketOverview,
  parseCategories,
  parseFearGreed,
  parseFearGreedHistory,
  parseGlobal,
  parseMarkets,
  toBinanceUsdtPair,
} from "./marketOverview";

/** Accès indexé gardé (noUncheckedIndexedAccess actif). */
function at<T>(arr: T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`élément ${i} absent`);
  return v;
}

describe("parseGlobal", () => {
  it("extrait mcap total, volume, dominances et variation 24 h", () => {
    const json = {
      data: {
        total_market_cap: { usd: 2_400_000_000_000 },
        total_volume: { usd: 95_000_000_000 },
        market_cap_percentage: { btc: 54.2, eth: 17.1 },
        market_cap_change_percentage_24h_usd: -1.35,
      },
    };
    const g = parseGlobal(json);
    expect(g.totalMcapUsd).toBe(2_400_000_000_000);
    expect(g.totalVolumeUsd).toBe(95_000_000_000);
    expect(g.btcDominance).toBeCloseTo(54.2, 5);
    expect(g.ethDominance).toBeCloseTo(17.1, 5);
    expect(g.mcapChangePct24h).toBeCloseTo(-1.35, 5);
  });

  it("tolère des champs manquants (→ 0)", () => {
    expect(parseGlobal({})).toEqual({
      totalMcapUsd: 0,
      totalVolumeUsd: 0,
      btcDominance: 0,
      ethDominance: 0,
      mcapChangePct24h: 0,
    });
    expect(parseGlobal(null)).toMatchObject({ totalMcapUsd: 0 });
  });
});

describe("parseMarkets", () => {
  it("mappe les entrées, met le symbole en majuscules et trie par mcap décroissante", () => {
    const json = [
      { id: "ethereum", symbol: "eth", name: "Ethereum", current_price: 3400, market_cap: 410e9, price_change_percentage_24h: 2.1 },
      { id: "bitcoin", symbol: "btc", name: "Bitcoin", current_price: 68000, market_cap: 1330e9, price_change_percentage_24h: -0.8 },
    ];
    const tiles = parseMarkets(json);
    expect(tiles).toHaveLength(2);
    // Trié : BTC (mcap plus grosse) d'abord.
    expect(at(tiles, 0).symbol).toBe("BTC");
    expect(at(tiles, 0).name).toBe("Bitcoin");
    expect(at(tiles, 0).changePct24h).toBeCloseTo(-0.8, 5);
    expect(at(tiles, 1).symbol).toBe("ETH");
  });

  it("ignore les entrées sans id/symbol ou de mcap ≤ 0", () => {
    const json = [
      { id: "bitcoin", symbol: "btc", name: "Bitcoin", market_cap: 1330e9 },
      { id: "", symbol: "x", market_cap: 5 }, // id vide
      { id: "y", symbol: "", market_cap: 5 }, // symbole vide
      { id: "z", symbol: "z", market_cap: 0 }, // mcap nulle
      { id: "w", symbol: "w", market_cap: -10 }, // mcap négative
    ];
    const tiles = parseMarkets(json);
    expect(tiles).toHaveLength(1);
    expect(at(tiles, 0).symbol).toBe("BTC");
  });

  it("price_change null → 0 (tuile neutre)", () => {
    const tiles = parseMarkets([
      { id: "a", symbol: "a", name: "A", market_cap: 100, price_change_percentage_24h: null },
    ]);
    expect(at(tiles, 0).changePct24h).toBe(0);
  });

  it("parse les périodes 7 j / 30 j (champs *_in_currency) ; absentes ou null → NULL (jamais 0)", () => {
    const tiles = parseMarkets([
      {
        id: "a",
        symbol: "a",
        name: "A",
        market_cap: 100,
        price_change_percentage_24h: 1.5,
        price_change_percentage_7d_in_currency: -4.2,
        price_change_percentage_30d_in_currency: 12.75,
      },
      { id: "b", symbol: "b", name: "B", market_cap: 50, price_change_percentage_7d_in_currency: null },
    ]);
    expect(at(tiles, 0).changePct7j).toBeCloseTo(-4.2, 10);
    expect(at(tiles, 0).changePct30j).toBeCloseTo(12.75, 10);
    // Réponse SANS le paramètre de périodes (ou null) : NULL préservé — un 0
    // fabriqué diluerait les moyennes pondérées de SECT vers 0 et s'afficherait
    // « +0.00% » en vert (revue Lot 3). Le Δ24 h garde sa convention 0 (MAP).
    expect(at(tiles, 1).changePct7j).toBeNull();
    expect(at(tiles, 1).changePct30j).toBeNull();
  });

  it("entrée non-tableau → liste vide", () => {
    expect(parseMarkets({})).toEqual([]);
    expect(parseMarkets(null)).toEqual([]);
  });
});

describe("parseCategories", () => {
  it("mappe les secteurs et trie par |Δ24 h| décroissant", () => {
    const json = [
      { id: "meme-token", name: "Meme", market_cap: 60e9, market_cap_change_24h: 1.2 },
      { id: "ai-big-data", name: "AI", market_cap: 40e9, market_cap_change_24h: -8.5 },
      { id: "layer-1", name: "Layer 1", market_cap: 900e9, market_cap_change_24h: 0.4 },
    ];
    const secteurs = parseCategories(json);
    expect(secteurs).toHaveLength(3);
    // |−8.5| > |1.2| > |0.4|
    expect(at(secteurs, 0).name).toBe("AI");
    expect(at(secteurs, 1).name).toBe("Meme");
    expect(at(secteurs, 2).name).toBe("Layer 1");
  });

  it("market_cap_change_24h null → 0 ; ignore les entrées sans nom", () => {
    const secteurs = parseCategories([
      { id: "x", name: "X", market_cap: 1, market_cap_change_24h: null },
      { id: "y", market_cap: 1 }, // pas de nom
    ]);
    expect(secteurs).toHaveLength(1);
    expect(at(secteurs, 0).changePct24h).toBe(0);
  });
});

describe("parseFearGreed", () => {
  it("convertit value/timestamp (chaînes) en nombre + ms epoch", () => {
    const json = { data: [{ value: "45", value_classification: "Fear", timestamp: "1710000000" }] };
    const fng = parseFearGreed(json);
    expect(fng).not.toBeNull();
    expect(fng?.value).toBe(45);
    expect(fng?.classification).toBe("Fear");
    expect(fng?.time).toBe(1710000000 * 1000);
  });

  it("données vides/invalides → null", () => {
    expect(parseFearGreed({ data: [] })).toBeNull();
    expect(parseFearGreed({})).toBeNull();
    expect(parseFearGreed({ data: [{ value: "abc" }] })).toBeNull();
  });
});

describe("parseFearGreedHistory", () => {
  it("mappe data[] en points {time ms, value} triés par temps croissant", () => {
    const json = {
      data: [
        { value: "72", timestamp: "1710086400" },
        { value: "45", timestamp: "1710000000" },
      ],
    };
    expect(parseFearGreedHistory(json)).toEqual([
      { time: 1710000000 * 1000, value: 45 },
      { time: 1710086400 * 1000, value: 72 },
    ]);
  });

  it("écarte le non-numérique et renvoie [] hors tableau", () => {
    expect(parseFearGreedHistory({ data: [{ value: "x", timestamp: "1" }] })).toEqual([]);
    expect(parseFearGreedHistory({})).toEqual([]);
  });
});

describe("toBinanceUsdtPair", () => {
  it("suffixe USDT et met en majuscules", () => {
    expect(toBinanceUsdtPair("btc")).toBe("BTCUSDT");
    expect(toBinanceUsdtPair(" eth ")).toBe("ETHUSDT");
  });
});

describe("fetchMarketOverview — budget strict de requêtes (critère SECT no 2)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("un refresh = EXACTEMENT 3 requêtes, et /coins/markets épingle 24h,7d,30d", async () => {
    // En env node (pas de localStorage) le cache 5 min est inopérant : le fetch a
    // toujours lieu — parfait pour compter les requêtes d'un refresh complet.
    const urls: string[] = [];
    const bouchon = vi.fn(async (entree: RequestInfo | URL) => {
      const url = String(entree);
      urls.push(url);
      const corps = url.includes("/coins/markets")
        ? [
            {
              id: "bitcoin",
              symbol: "btc",
              name: "Bitcoin",
              current_price: 1,
              market_cap: 2,
              price_change_percentage_24h: 1,
              price_change_percentage_7d_in_currency: 2,
              price_change_percentage_30d_in_currency: 3,
            },
          ]
        : url.includes("/global")
          ? { data: {} }
          : [];
      return { ok: true, status: 200, statusText: "OK", json: async () => corps } as Response;
    });
    vi.stubGlobal("fetch", bouchon);

    const overview = await fetchMarketOverview();

    // Budget strict : SECT n'ajoute AUCUN appel — toujours 3 requêtes par refresh.
    expect(bouchon).toHaveBeenCalledTimes(3);
    const marches = urls.find((u) => u.includes("/coins/markets"));
    expect(marches).toContain("price_change_percentage=24h,7d,30d");
    // Les périodes voyagent bien jusqu'aux tuiles (mêmes octets, zéro requête en plus).
    expect(overview.coins[0]?.changePct7j).toBe(2);
    expect(overview.coins[0]?.changePct30j).toBe(3);
  });
});
