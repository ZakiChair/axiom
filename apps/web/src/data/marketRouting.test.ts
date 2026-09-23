import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveMarketCandidates, searchMarkets, type MarketCatalog } from "./marketRouting";

const catalogue: MarketCatalog = { unavailableSources: [], instruments: [
  { exchange: "binance", symbol: "BTCUSDT", kind: "spot" },
  { exchange: "kraken", symbol: "BTCUSDT", kind: "spot" },
  { exchange: "coinbase", symbol: "BTCUSD", kind: "spot" },
  { exchange: "bybit", symbol: "SPECIALUSDT", kind: "spot" },
  { exchange: "hyperliquid", symbol: "BTC-PERP", kind: "perp" },
  { exchange: "twelvedata", symbol: "SPY", kind: "tradfi" },
] };

describe("routage automatique des actifs", () => {
  it("déduplique les places spot mais distingue quote et contrat perp", () => {
    expect(searchMarkets(catalogue, "BTC").map((x) => [x.symbol, x.exchange])).toEqual([
      ["BTCUSDT", "binance"], ["BTCUSD", "coinbase"], ["BTC-PERP", "hyperliquid"],
    ]);
  });
  it("choisit la source portant effectivement une paire absente de la source précédente", async () => {
    expect(await resolveMarketCandidates({ exchange: "binance", symbol: "SPECIALUSDT", timeframe: "1h" }, catalogue))
      .toEqual([{ exchange: "bybit", symbol: "SPECIALUSDT", timeframe: "1h" }]);
  });
  it("ne remplace ni la devise de cotation ni le spot par un perp", async () => {
    expect(await resolveMarketCandidates({ symbol: "BTCUSDC", timeframe: "1h" }, catalogue)).toEqual([]);
    expect(await resolveMarketCandidates({ symbol: "BTCUSDT", timeframe: "1h" }, catalogue))
      .toEqual([{ exchange: "binance", symbol: "BTCUSDT", timeframe: "1h" }, { exchange: "kraken", symbol: "BTCUSDT", timeframe: "1h" }]);
  });
  it("garde un fournisseur valide et migre les anciens HL sans changer de marché", async () => {
    expect((await resolveMarketCandidates({ exchange: "kraken", symbol: "BTCUSDT", timeframe: "1h" }, catalogue))[0]?.exchange).toBe("kraken");
    for (const symbol of ["BTC", "BTCUSDT"]) {
      expect(await resolveMarketCandidates({ exchange: "hyperliquid", symbol, timeframe: "1h" }, catalogue))
        .toEqual([{ exchange: "hyperliquid", symbol: "BTC-PERP", timeframe: "1h" }]);
    }
  });
  it("garde le timeframe si une place le supporte et ajuste sinon", async () => {
    expect((await resolveMarketCandidates({ exchange: "kraken", symbol: "BTCUSDT", timeframe: "3M" }, catalogue))[0])
      .toEqual({ exchange: "binance", symbol: "BTCUSDT", timeframe: "3M" });
    expect((await resolveMarketCandidates({ symbol: "SPECIALUSDT", timeframe: "1s" }, catalogue))[0]?.timeframe).toBe("1h");
  });
  it("normalise les alias et les séparateurs sans confondre le forex", async () => {
    expect((await resolveMarketCandidates({ symbol: "XBT/USD", timeframe: "1h" }, catalogue))[0]?.symbol).toBe("BTCUSD");
    expect((await resolveMarketCandidates({ symbol: "USD/SEK", timeframe: "1h" }, catalogue))[0]?.exchange).toBe("twelvedata");
  });
  it("une indisponibilité de catalogue permet de vérifier l'ancienne source par son backfill", async () => {
    expect(await resolveMarketCandidates({ exchange: "binance", symbol: "ETHUSDT", timeframe: "1h" }, { instruments: [], unavailableSources: ["binance"] }))
      .toEqual([{ exchange: "binance", symbol: "ETHUSDT", timeframe: "1h", speculative: true }]);
  });
});

describe("catalogue partiel et repli sur le même instrument", () => {
  it("vérifie CARDSUSDT chez OKX et MEXC quand leurs catalogues manquent, sans imposer Binance", async () => {
    const partial: MarketCatalog = { instruments: [], unavailableSources: ["okx", "mexc", "hyperliquid", "twelvedata"] };
    expect(await resolveMarketCandidates({ exchange: "binance", symbol: "CARDSUSDT", timeframe: "1h" }, partial)).toEqual([
      { exchange: "okx", symbol: "CARDSUSDT", timeframe: "1h", speculative: true },
      { exchange: "mexc", symbol: "CARDSUSDT", timeframe: "1h", speculative: true },
    ]);
  });
  it("essaie les sources confirmées avant une provenance restaurée dont le catalogue manque", async () => {
    const partial: MarketCatalog = { instruments: [{ exchange: "okx", symbol: "CARDSUSDT", kind: "spot" }], unavailableSources: ["binance", "mexc"] };
    expect(await resolveMarketCandidates({ exchange: "binance", symbol: "CARDSUSDT", timeframe: "1h" }, partial)).toEqual([
      { exchange: "okx", symbol: "CARDSUSDT", timeframe: "1h" },
      { exchange: "binance", symbol: "CARDSUSDT", timeframe: "1h", speculative: true },
      { exchange: "mexc", symbol: "CARDSUSDT", timeframe: "1h", speculative: true },
    ]);
  });
  it("ne remplace jamais le perp par le spot quand le catalogue Hyperliquid manque", async () => {
    const partial: MarketCatalog = { instruments: [{ exchange: "okx", symbol: "CARDSUSDT", kind: "spot" }], unavailableSources: ["binance", "hyperliquid"] };
    expect(await resolveMarketCandidates({ symbol: "CARDS-PERP", timeframe: "1h" }, partial)).toEqual([
      { exchange: "hyperliquid", symbol: "CARDS-PERP", timeframe: "1h", speculative: true },
    ]);
  });
  it("respecte une absence prouvée par un catalogue sain et la devise demandée", async () => {
    expect(await resolveMarketCandidates({ exchange: "binance", symbol: "CARDSUSDT", timeframe: "1h" }, { instruments: [], unavailableSources: [] })).toEqual([]);
    expect(await resolveMarketCandidates({ symbol: "CARDSUSDC", timeframe: "1h" }, {
      instruments: [{ exchange: "okx", symbol: "CARDSUSDT", kind: "spot" }], unavailableSources: ["mexc"],
    })).toEqual([{ exchange: "mexc", symbol: "CARDSUSDC", timeframe: "1h", speculative: true }]);
  });
  it("CARDS confirmé chez OKX reste prioritaire en 1h face à Binance spéculatif en 1s", async () => {
    expect(await resolveMarketCandidates({ exchange: "binance", symbol: "CARDSUSDT", timeframe: "1s" }, {
      instruments: [{ exchange: "okx", symbol: "CARDSUSDT", kind: "spot" }], unavailableSources: ["binance"],
    })).toEqual([
      { exchange: "okx", symbol: "CARDSUSDT", timeframe: "1h" },
      { exchange: "binance", symbol: "CARDSUSDT", timeframe: "1s", speculative: true },
    ]);
  });
});

describe("renouvellement du catalogue partagé", () => {
  beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  const response = (value: unknown) => ({ ok: true, json: async () => value });
  const okx = (symbol: string) => response({ code: "0", data: [{ instId: symbol, instType: "SPOT", state: "live" }] });

  it("publie le retour de CARDS après une panne, sans republier les lectures du cache", async () => {
    let recovered = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("okx") && recovered) return okx("CARDS-USDT");
      throw new Error("indisponible");
    }));
    const routing = await import("./marketRouting");
    const published: MarketCatalog[] = [];
    const unsubscribe = routing.subscribeMarketCatalog((catalog) => published.push(catalog));
    const initial = await routing.fetchMarketCatalog();
    expect(initial.unavailableSources).toContain("okx");
    expect(await routing.fetchMarketCatalog()).toBe(initial);
    expect(published).toEqual([initial]);
    recovered = true;
    await vi.advanceTimersByTimeAsync(30_000);
    const refreshed = await routing.fetchMarketCatalog();
    expect(routing.searchMarkets(refreshed, "CARDSUSDT")).toEqual([{ exchange: "okx", symbol: "CARDSUSDT", kind: "spot" }]);
    expect(published).toEqual([initial, refreshed]);
    unsubscribe();
    await routing.fetchMarketCatalog({ force: true });
    expect(published).toHaveLength(2);
  });

  it("force rafraîchit aussi les catalogues sources réussis et déduplique les demandes", async () => {
    let symbol = "BTC-USDT";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("okx")) return okx(symbol);
      throw new Error("indisponible");
    }));
    const routing = await import("./marketRouting");
    await routing.fetchMarketCatalog();
    symbol = "CARDS-USDT";
    const first = routing.fetchMarketCatalog({ force: true });
    const second = routing.fetchMarketCatalog({ force: true });
    expect(first).toBe(second);
    expect(routing.searchMarkets(await first, "CARDSUSDT")).toEqual([{ exchange: "okx", symbol: "CARDSUSDT", kind: "spot" }]);
  });

  it("un catalogue entièrement réussi expire et découvre un nouveau listing", async () => {
    let cards = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("okx")) return okx(cards ? "CARDS-USDT" : "BTC-USDT");
      if (url.includes("bybit")) return response({ retCode: 0, result: { list: [{ symbol: "BTCUSDT", status: "Trading" }] } });
      if (url.includes("kraken")) return response({ result: { btc: { wsname: "BTC/USD", status: "online" } } });
      if (url.includes("coinbase")) return response({ products: [{ product_id: "BTC-USD", product_type: "SPOT" }] });
      if (url.includes("hyperliquid")) return response({ universe: [{ name: "BTC" }] });
      return response({ symbols: [{ symbol: "BTCUSDT", status: url.includes("mexc") ? "1" : "TRADING", isSpotTradingAllowed: true }] });
    }));
    const routing = await import("./marketRouting");
    const initial = await routing.fetchMarketCatalog();
    expect(initial.unavailableSources).toEqual([]);
    cards = true;
    await vi.advanceTimersByTimeAsync(300_000);
    const refreshed = await routing.fetchMarketCatalog();
    expect(routing.searchMarkets(refreshed, "CARDSUSDT")).toEqual([{ exchange: "okx", symbol: "CARDSUSDT", kind: "spot" }]);
  });
  it("un abonné défaillant n'empêche ni le catalogue ni les autres vues de se mettre à jour", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("okx")) return okx("CARDS-USDT");
      throw new Error("indisponible");
    }));
    const routing = await import("./marketRouting");
    routing.subscribeMarketCatalog(() => { throw new Error("vue démontée"); });
    const received: MarketCatalog[] = [];
    routing.subscribeMarketCatalog((catalog) => received.push(catalog));
    const catalog = await routing.fetchMarketCatalog();
    expect(routing.searchMarkets(catalog, "CARDSUSDT")).toEqual([{ exchange: "okx", symbol: "CARDSUSDT", kind: "spot" }]);
    expect(received).toEqual([catalog]);
  });
});

describe("ETF et provenance TradFi restaurée", () => {
  const vide: MarketCatalog = { instruments: [], unavailableSources: [] };
  it("préserve GBTC restauré chez Twelve Data, sans l'interpréter comme une paire G/BTC", async () => {
    expect(await resolveMarketCandidates({ exchange: "twelvedata", symbol: "GBTC", timeframe: "1h" }, vide))
      .toEqual([{ exchange: "twelvedata", symbol: "GBTC", timeframe: "1h" }]);
  });
  it("la provenance TradFi explicite ne dépend pas du catalogue curé ni des suffixes crypto", async () => {
    // Identifiant libre hypothétique : le fournisseur explicite porte déjà la nature du marché.
    expect(await resolveMarketCandidates({ exchange: "twelvedata", symbol: "TESTBTC", timeframe: "1h" }, vide))
      .toEqual([{ exchange: "twelvedata", symbol: "TESTBTC", timeframe: "1h" }]);
  });
  it.each(["GBTC", "IBIT", "ETHA", "ETHE"])("classe automatiquement l'ETF %s", async (symbol) => {
    expect(await resolveMarketCandidates({ symbol, timeframe: "1h" }, vide))
      .toEqual([{ exchange: "twelvedata", symbol, timeframe: "1h" }]);
  });
  it("conserve les vraies paires WBTC/BTC et WBTCUSDT comme spot", async () => {
    const crypto: MarketCatalog = { unavailableSources: [], instruments: [
      { exchange: "binance", symbol: "WBTCBTC", kind: "spot" },
      { exchange: "binance", symbol: "WBTCUSDT", kind: "spot" },
    ] };
    for (const symbol of ["WBTC/BTC", "WBTCUSDT"]) {
      expect(await resolveMarketCandidates({ symbol, timeframe: "1h" }, crypto))
        .toEqual([{ exchange: "binance", symbol: symbol.replace("/", ""), timeframe: "1h" }]);
    }
  });
});

describe("recherche du pétrole : identité spot, action et ETF distinctes", () => {
  const oil: MarketCatalog = { unavailableSources: [], instruments: [
    { exchange: "mexc", symbol: "USOILUSDT", kind: "spot" },
    { exchange: "twelvedata", symbol: "WTI/USD", kind: "tradfi" },
    { exchange: "twelvedata", symbol: "WTI", kind: "tradfi" },
    { exchange: "twelvedata", symbol: "USO", kind: "tradfi" },
  ] };
  it("USOIL propose le spot WTI/USD avant un symbole crypto ressemblant et jamais l'ETF USO", () => {
    const results = searchMarkets(oil, "USOIL");
    expect(results[0]).toMatchObject({ symbol: "WTI/USD", exchange: "twelvedata", label: "Pétrole WTI — spot" });
    expect(results.some((result) => result.symbol === "USO")).toBe(false);
  });
  it("l'exact WTI reste l'action, indépendamment de la suggestion pétrole", () => {
    expect(searchMarkets(oil, "WTI")[0]).toMatchObject({ symbol: "WTI", label: "W&T Offshore — action" });
    expect(searchMarkets(oil, "USO")[0]?.symbol).toBe("USO");
  });
  it.each(["binance", "bybit", "kraken", "coinbase", "okx", "mexc", "hyperliquid", "twelvedata", "synthetic"] as const)("WTI/USD garde sa nature TradFi depuis %s", async (exchange) => {
    expect(await resolveMarketCandidates({ exchange, symbol: "WTI/USD", timeframe: "1h" }, oil))
      .toEqual([{ exchange: "twelvedata", symbol: "WTI/USD", timeframe: "1h" }]);
  });
  it.each(["USOIL", "WTI", "USO"])("ne réécrit jamais le symbole brut %s dans le résolveur", async (symbol) => {
    expect(await resolveMarketCandidates({ symbol, timeframe: "1h" }, oil))
      .toEqual([{ exchange: "twelvedata", symbol, timeframe: "1h" }]);
  });
});
