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
  it("Binance confirmé passe devant une provenance héritée, qui départage ensuite les replis ; anciens HL migrés", async () => {
    expect(await resolveMarketCandidates({ exchange: "kraken", symbol: "BTCUSDT", timeframe: "1h" }, catalogue))
      .toEqual([{ exchange: "binance", symbol: "BTCUSDT", timeframe: "1h" }, { exchange: "kraken", symbol: "BTCUSDT", timeframe: "1h" }]);
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

describe("Binance, source de référence du split taker, avant la provenance courante", () => {
  const multi: MarketCatalog = { unavailableSources: [], instruments: [
    { exchange: "okx", symbol: "BTCUSDT", kind: "spot" },
    { exchange: "kraken", symbol: "BTCUSDT", kind: "spot" },
    { exchange: "binance", symbol: "BTCUSDT", kind: "spot" },
    { exchange: "binance", symbol: "AAVEUSDT", kind: "spot" },
    { exchange: "okx", symbol: "AAVEUSDT", kind: "spot" },
    { exchange: "okx", symbol: "CARDSUSDT", kind: "spot" },
  ] };
  const tf = "1M" as const;
  it.each(["BTCUSDT", "AAVEUSDT"])("okx:%s collé à OKX repart de Binance, OKX reste le premier repli", async (symbol) => {
    const order = (await resolveMarketCandidates({ exchange: "okx", symbol, timeframe: tf }, multi)).map((c) => c.exchange);
    expect(order[0]).toBe("binance");
    expect(order[1]).toBe("okx");
  });
  it("hors Binance, la provenance courante départage les replis avant l'ordre des sources", async () => {
    const sansBinance: MarketCatalog = { ...multi, instruments: multi.instruments.filter((c) => c.exchange !== "binance") };
    expect((await resolveMarketCandidates({ exchange: "okx", symbol: "BTCUSDT", timeframe: tf }, sansBinance)).map((c) => c.exchange))
      .toEqual(["okx", "kraken"]);
  });
  it("CARDSUSDT, propre à OKX, reste chez OKX quelle que soit la provenance", async () => {
    for (const exchange of ["binance", "okx"] as const) {
      expect(await resolveMarketCandidates({ exchange, symbol: "CARDSUSDT", timeframe: "1h" }, multi))
        .toEqual([{ exchange: "okx", symbol: "CARDSUSDT", timeframe: "1h" }]);
    }
  });
  it("catalogue Binance en panne : la provenance Binance restaurée garde la tête, jamais une troisième place d'abord", async () => {
    const binanceKo: MarketCatalog = { unavailableSources: ["binance"], instruments: [
      { exchange: "bybit", symbol: "ETHUSDT", kind: "spot" }, { exchange: "okx", symbol: "ETHUSDT", kind: "spot" },
    ] };
    expect(await resolveMarketCandidates({ exchange: "binance", symbol: "ETHUSDT", timeframe: "1h" }, binanceKo)).toEqual([
      { exchange: "binance", symbol: "ETHUSDT", timeframe: "1h", speculative: true },
      { exchange: "bybit", symbol: "ETHUSDT", timeframe: "1h" },
      { exchange: "okx", symbol: "ETHUSDT", timeframe: "1h" },
    ]);
    // Une autre provenance confirmée reste en tête ; Binance non confirmé n'y passe pas.
    expect((await resolveMarketCandidates({ exchange: "okx", symbol: "ETHUSDT", timeframe: "1h" }, binanceKo)).map((c) => c.exchange))
      .toEqual(["okx", "bybit", "binance"]);
  });
  it("aucune oscillation : Binance en échec, le repli retenu garde la tête jusqu'au retour de son catalogue", async () => {
    const binanceKo: MarketCatalog = { unavailableSources: ["binance"], instruments: multi.instruments.filter((c) => c.exchange !== "binance") };
    const depuisBinance = await resolveMarketCandidates({ exchange: "binance", symbol: "BTCUSDT", timeframe: "1h" }, binanceKo);
    expect(depuisBinance[0]).toEqual({ exchange: "binance", symbol: "BTCUSDT", timeframe: "1h", speculative: true });
    expect(depuisBinance[1]?.exchange).toBe("kraken");
    // Provenance publiée après le repli : la même source reste en tête, Binance toujours en dernier.
    const depuisRepli = await resolveMarketCandidates({ exchange: "kraken", symbol: "BTCUSDT", timeframe: "1h" }, binanceKo);
    expect(depuisRepli[0]?.exchange).toBe("kraken");
    expect(depuisRepli.at(-1)?.speculative).toBe(true);
    // Catalogue Binance rétabli : retour en tête sans action de l'utilisateur.
    expect((await resolveMarketCandidates({ exchange: "kraken", symbol: "BTCUSDT", timeframe: "1h" }, multi))[0]?.exchange).toBe("binance");
  });
  it("catalogues tous indisponibles : la provenance restaurée garde la tête, Binance non confirmé ne passe pas devant", async () => {
    const horsLigne: MarketCatalog = { instruments: [], unavailableSources: ["binance", "kraken", "coinbase", "bybit", "okx", "mexc", "twelvedata", "hyperliquid"] };
    for (const symbol of ["BTCUSDT", "BTCUSD"]) {
      expect((await resolveMarketCandidates({ exchange: "kraken", symbol, timeframe: "1m" }, horsLigne)).map((c) => c.exchange))
        .toEqual(["kraken", "binance", "coinbase", "bybit", "okx", "mexc"]);
    }
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
  it("une provenance restaurée dont le catalogue manque est essayée d'abord, puis les sources confirmées", async () => {
    const partial: MarketCatalog = { instruments: [{ exchange: "okx", symbol: "CARDSUSDT", kind: "spot" }], unavailableSources: ["binance", "mexc"] };
    expect(await resolveMarketCandidates({ exchange: "binance", symbol: "CARDSUSDT", timeframe: "1h" }, partial)).toEqual([
      { exchange: "binance", symbol: "CARDSUSDT", timeframe: "1h", speculative: true },
      { exchange: "okx", symbol: "CARDSUSDT", timeframe: "1h" },
      { exchange: "mexc", symbol: "CARDSUSDT", timeframe: "1h", speculative: true },
    ]);
    // Sans provenance, les sources confirmées passent devant tout essai spéculatif.
    expect((await resolveMarketCandidates({ symbol: "CARDSUSDT", timeframe: "1h" }, partial)).map((c) => c.exchange))
      .toEqual(["okx", "binance", "mexc"]);
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
  it("CARDS confirmé chez OKX reste prioritaire en 1h face à Binance spéculatif en 1s hérité d'un autre actif", async () => {
    const partiel: MarketCatalog = { instruments: [{ exchange: "okx", symbol: "CARDSUSDT", kind: "spot" }], unavailableSources: ["binance"] };
    expect(await resolveMarketCandidates({ exchange: "okx", symbol: "CARDSUSDT", timeframe: "1s" }, partiel)).toEqual([
      { exchange: "okx", symbol: "CARDSUSDT", timeframe: "1h" },
      { exchange: "binance", symbol: "CARDSUSDT", timeframe: "1s", speculative: true },
    ]);
    // Provenance Binance restaurée : essayée d'abord dans son unité de temps, OKX 1h en repli.
    expect((await resolveMarketCandidates({ exchange: "binance", symbol: "CARDSUSDT", timeframe: "1s" }, partiel)).map((c) => `${c.exchange}@${c.timeframe}`))
      .toEqual(["binance@1s", "okx@1h"]);
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
    // Lecture expirée : servie tout de suite, le rafraîchissement publie ensuite.
    expect(await routing.fetchMarketCatalog()).toBe(initial);
    await vi.advanceTimersByTimeAsync(0);
    const refreshed = published[1]!;
    expect(routing.searchMarkets(refreshed, "CARDSUSDT")).toEqual([{ exchange: "okx", symbol: "CARDSUSDT", kind: "spot" }]);
    expect(published).toEqual([initial, refreshed]);
    expect(await routing.fetchMarketCatalog()).toBe(refreshed);
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
    expect(await routing.fetchMarketCatalog()).toBe(initial);
    await vi.advanceTimersByTimeAsync(0);
    const refreshed = await routing.fetchMarketCatalog();
    expect(routing.searchMarkets(refreshed, "CARDSUSDT")).toEqual([{ exchange: "okx", symbol: "CARDSUSDT", kind: "spot" }]);
  });
  const sainsSauf = (okxResponse: () => Promise<unknown>) => vi.fn(async (url: string) => {
    if (url.includes("okx")) return okxResponse();
    if (url.includes("bybit")) return response({ retCode: 0, result: { list: [{ symbol: "BTCUSDT", status: "Trading" }] } });
    if (url.includes("kraken")) return response({ result: { btc: { wsname: "BTC/USD", status: "online" } } });
    if (url.includes("coinbase")) return response({ products: [{ product_id: "BTC-USD", product_type: "SPOT" }] });
    if (url.includes("hyperliquid")) return response({ universe: [{ name: "BTC" }] });
    return response({ symbols: [{ symbol: "BTCUSDT", status: url.includes("mexc") ? "1" : "TRADING", isSpotTradingAllowed: true }] });
  });

  it("un catalogue expiré est servi immédiatement et rafraîchi en arrière-plan, une seule requête en vol", async () => {
    let cards = false;
    const fetch = sainsSauf(() => cards
      ? new Promise((resolve) => setTimeout(() => resolve(okx("CARDS-USDT")), 5_000))
      : Promise.resolve(okx("BTC-USDT")));
    vi.stubGlobal("fetch", fetch);
    const routing = await import("./marketRouting");
    const published: MarketCatalog[] = [];
    routing.subscribeMarketCatalog((catalog) => published.push(catalog));
    const initial = await routing.fetchMarketCatalog();
    const okxCalls = () => fetch.mock.calls.filter(([url]) => String(url).includes("okx")).length;
    cards = true;
    await vi.advanceTimersByTimeAsync(300_000);
    // OKX met 5 s à répondre : les lectures n'attendent pas et ne relancent rien.
    expect(await routing.fetchMarketCatalog()).toBe(initial);
    expect(await routing.fetchMarketCatalog()).toBe(initial);
    expect(await routing.resolveMarketCandidates({ symbol: "BTCUSDT", timeframe: "1h" })).toContainEqual({ exchange: "binance", symbol: "BTCUSDT", timeframe: "1h" });
    expect(okxCalls()).toBe(2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(published).toHaveLength(2);
    expect(routing.searchMarkets(published[1]!, "CARDSUSDT")).toEqual([{ exchange: "okx", symbol: "CARDSUSDT", kind: "spot" }]);
    expect(await routing.fetchMarketCatalog()).toBe(published[1]);
  });

  /** Catalogue sain ; une fois `nouveau`, Binance cote NEWUSDT et OKX met 3 s à répondre. */
  const nouvelleCotation = () => {
    const etat = { nouveau: false };
    const base = sainsSauf(() => etat.nouveau
      ? new Promise((resolve) => setTimeout(() => resolve(okx("BTC-USDT")), 3_000))
      : Promise.resolve(okx("BTC-USDT")));
    const fetch = vi.fn(async (url: string) => etat.nouveau && url.includes("api.binance.com")
      ? response({ symbols: ["BTCUSDT", "NEWUSDT"].map((symbol) => ({ symbol, status: "TRADING" })) })
      : base(url));
    return { etat, fetch };
  };

  it("catalogue périmé sans l'actif : le chargement attend le rafraîchissement lent qui l'apporte", async () => {
    const { etat, fetch } = nouvelleCotation();
    vi.stubGlobal("fetch", fetch);
    const routing = await import("./marketRouting");
    const { chargerAvecRepli } = await import("../chart/routageMarche");
    await routing.fetchMarketCatalog();
    etat.nouveau = true;
    await vi.advanceTimersByTimeAsync(300_000);
    const candidats = await routing.resolveMarketCandidatesProgressifs({ symbol: "NEWUSDT", timeframe: "1h" });
    expect(candidats.immediats).toEqual([]);
    const bougie = { time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 };
    let issue: unknown = "en attente";
    chargerAvecRepli(candidats, async () => [bougie], () => false).then((value) => { issue = value; }, (error: Error) => { issue = error.message; });
    await vi.advanceTimersByTimeAsync(2_999);
    expect(issue).toBe("en attente");
    await vi.advanceTimersByTimeAsync(1);
    expect(issue).toEqual({ identity: { exchange: "binance", symbol: "NEWUSDT", timeframe: "1h" }, candles: [bougie] });
  });

  it("catalogue périmé sans l'actif, place muette : le graphe attend la liste fraîche sans essai spéculatif préalable", async () => {
    // MEXC ne répond jamais (indisponible dès le premier tour) ; OKX cote NEWUSDT au second.
    let nouveau = false;
    const base = sainsSauf(() => Promise.resolve(okx(nouveau ? "NEW-USDT" : "BTC-USDT")));
    vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("mexc") ? new Promise(() => {}) : base(url)));
    const routing = await import("./marketRouting");
    const { chargerAvecRepli } = await import("../chart/routageMarche");
    const initial = routing.fetchMarketCatalog();
    await vi.advanceTimersByTimeAsync(12_000);
    expect((await initial).unavailableSources).toEqual(["mexc"]);
    nouveau = true;
    await vi.advanceTimersByTimeAsync(300_000);
    const candidats = await routing.resolveMarketCandidatesProgressifs({ exchange: "okx", symbol: "NEWUSDT", timeframe: "1h" });
    expect(candidats.immediats).toEqual([]);
    const essais: string[] = [];
    const bougie = { time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 };
    let issue: unknown = "en attente";
    void chargerAvecRepli(candidats, async ({ exchange }) => {
      essais.push(exchange);
      return exchange === "okx" ? [bougie] : new Promise<never>(() => {});
    }, () => false).then((value) => { issue = value; });
    // La liste fraîche arrive au délai du catalogue MEXC (12 s), puis OKX part directement.
    await vi.advanceTimersByTimeAsync(12_000);
    expect(issue).toEqual({ identity: { exchange: "okx", symbol: "NEWUSDT", timeframe: "1h" }, candles: [bougie] });
    expect(essais).toEqual(["okx"]);
  });

  it("résolution simple (ticker, SYN) : un actif absent du catalogue périmé attend son rafraîchissement", async () => {
    const { etat, fetch } = nouvelleCotation();
    vi.stubGlobal("fetch", fetch);
    const routing = await import("./marketRouting");
    await routing.fetchMarketCatalog();
    etat.nouveau = true;
    await vi.advanceTimersByTimeAsync(300_000);
    let resolu: unknown;
    void routing.resolveMarketCandidates({ symbol: "NEWUSDT", timeframe: "1h" }).then((value) => { resolu = value; });
    await vi.advanceTimersByTimeAsync(2_999);
    expect(resolu).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(resolu).toEqual([{ exchange: "binance", symbol: "NEWUSDT", timeframe: "1h" }]);
  });

  it("force n'est pas absorbé par un rafraîchissement ordinaire qui rejoue les échecs mémorisés", async () => {
    let retabli = false;
    const base = sainsSauf(() => retabli ? Promise.resolve(okx("BTC-USDT"))
      : new Promise((_resolve, reject) => setTimeout(() => reject(new Error("HTTP 503")), 10_000)));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (!url.includes("kraken")) return base(url);
      if (!retabli) throw new Error("HTTP 503");
      return new Promise((resolve) => setTimeout(() => resolve(response({ result: { btc: { wsname: "BTC/USD", status: "online" } } })), 1_000));
    }));
    const routing = await import("./marketRouting");
    // Kraken échoue à t=0 (mémorisé jusqu'à 30 s), OKX à t=10 s (jusqu'à 40 s).
    const initial = routing.fetchMarketCatalog();
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await initial).unavailableSources).toEqual(["kraken", "okx"]);
    retabli = true;
    await vi.advanceTimersByTimeAsync(21_000);
    // t=31 s : une lecture ordinaire lance le rafraîchissement de fond (OKX encore mémorisé)…
    await routing.fetchMarketCatalog();
    await vi.advanceTimersByTimeAsync(500);
    // … puis l'événement « online » demande un rafraîchissement forcé.
    const force = routing.fetchMarketCatalog({ force: true });
    await vi.advanceTimersByTimeAsync(3_000);
    expect((await force).unavailableSources).toEqual([]);
  });

  it("force attend le réseau au lieu de servir le cache", async () => {
    let symbol = "BTC-USDT";
    vi.stubGlobal("fetch", sainsSauf(() => Promise.resolve(okx(symbol))));
    const routing = await import("./marketRouting");
    const initial = await routing.fetchMarketCatalog();
    symbol = "CARDS-USDT";
    const forced = await routing.fetchMarketCatalog({ force: true });
    expect(forced).not.toBe(initial);
    expect(routing.searchMarkets(forced, "CARDSUSDT")).toEqual([{ exchange: "okx", symbol: "CARDSUSDT", kind: "spot" }]);
  });

  it("un rafraîchissement au contenu identique ne republie pas et garde le même objet", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes("okx")) return okx("CARDS-USDT");
      throw new Error("indisponible");
    });
    vi.stubGlobal("fetch", fetch);
    const routing = await import("./marketRouting");
    const published: MarketCatalog[] = [];
    routing.subscribeMarketCatalog((catalog) => published.push(catalog));
    const initial = await routing.fetchMarketCatalog();
    for (let tour = 0; tour < 3; tour++) {
      await vi.advanceTimersByTimeAsync(31_000);
      expect(await routing.fetchMarketCatalog()).toBe(initial);
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(published).toEqual([initial]);
    // L'expiration a bien été renouvelée : une lecture immédiate ne relance aucun appel.
    const calls = fetch.mock.calls.length;
    expect(await routing.fetchMarketCatalog()).toBe(initial);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch.mock.calls.length).toBe(calls);
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

describe("résolution progressive : la source prioritaire n'attend pas les autres places", () => {
  beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  const response = (value: unknown) => ({ ok: true, json: async () => value });
  const muet = () => new Promise(() => {});
  /** Binance et Hyperliquid répondent ; OKX ne répond jamais ; les autres échouent. */
  const places = (options: { binance?: string[]; okx?: () => Promise<unknown>; hl?: string[] } = {}) => vi.fn((url: string) => {
    if (url.includes("binance")) return Promise.resolve(response({ symbols: (options.binance ?? ["BTCUSDT"]).map((symbol) => ({ symbol, status: "TRADING" })) }));
    if (url.includes("hyperliquid")) return Promise.resolve(response({ universe: (options.hl ?? ["BTC"]).map((name) => ({ name })) }));
    if (url.includes("okx")) return options.okx ? options.okx() : muet();
    return Promise.reject(new Error("indisponible"));
  });

  it.each(["binance", "okx"] as const)("à froid, %s:BTCUSDT part tout de suite sur Binance malgré une place muette", async (exchange) => {
    vi.stubGlobal("fetch", places());
    const routing = await import("./marketRouting");
    let resolu: Awaited<ReturnType<typeof routing.resolveMarketCandidatesProgressifs>> | undefined;
    void routing.resolveMarketCandidatesProgressifs({ exchange, symbol: "BTCUSDT", timeframe: "1h" }).then((value) => { resolu = value; });
    await vi.advanceTimersByTimeAsync(0);
    expect(resolu?.immediats).toEqual([{ exchange: "binance", symbol: "BTCUSDT", timeframe: "1h" }]);
    let complets: unknown;
    void resolu!.complets().then((value) => { complets = value; });
    await vi.advanceTimersByTimeAsync(11_999);
    expect(complets).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    // Liste complète habituelle : Binance d'abord, places sans catalogue en essais spéculatifs.
    expect((complets as Array<{ exchange: string; speculative?: true }>)[0]).toEqual({ exchange: "binance", symbol: "BTCUSDT", timeframe: "1h" });
    expect((complets as Array<{ exchange: string; speculative?: true }>).slice(1).every((c) => c.speculative)).toBe(true);
  });

  it("à froid, un actif absent de Binance attend le catalogue complet (CARDSUSDT chez OKX seul)", async () => {
    vi.stubGlobal("fetch", places({ okx: () => new Promise((resolve) => setTimeout(() => resolve(response({ code: "0", data: [{ instId: "CARDS-USDT", instType: "SPOT", state: "live" }] })), 1_000)) }));
    const routing = await import("./marketRouting");
    const pending = routing.resolveMarketCandidatesProgressifs({ exchange: "binance", symbol: "CARDSUSDT", timeframe: "1h" });
    await vi.advanceTimersByTimeAsync(0);
    const { immediats, complets } = await pending;
    expect(immediats).toEqual([]);
    const liste = complets();
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await liste)[0]).toEqual({ exchange: "okx", symbol: "CARDSUSDT", timeframe: "1h" });
  });

  it("à froid, un actif absent de Binance part sur sa provenance dès que son catalogue le confirme", async () => {
    // OKX répond en 1 s ; MEXC se tait (délai du catalogue : 12 s) ; les autres échouent.
    const reseau = places({ okx: () => new Promise((resolve) => setTimeout(() => resolve(response({ code: "0", data: [{ instId: "CARDS-USDT", instType: "SPOT", state: "live" }, { instId: "BTC-USDT", instType: "SPOT", state: "live" }] })), 1_000)) });
    vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("mexc") ? muet() : reseau(url)));
    const routing = await import("./marketRouting");
    type Progressifs = Awaited<ReturnType<typeof routing.resolveMarketCandidatesProgressifs>>;
    let cards: Progressifs | undefined;
    let btc: Progressifs | undefined;
    void routing.resolveMarketCandidatesProgressifs({ exchange: "okx", symbol: "CARDSUSDT", timeframe: "1h" }).then((value) => { cards = value; });
    void routing.resolveMarketCandidatesProgressifs({ exchange: "okx", symbol: "BTCUSDT", timeframe: "1h" }).then((value) => { btc = value; });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(cards?.immediats).toEqual([{ exchange: "okx", symbol: "CARDSUSDT", timeframe: "1h" }]);
    // Binance qui liste l'actif garde la tête : la provenance n'est qu'un second recours.
    expect(btc?.immediats).toEqual([{ exchange: "binance", symbol: "BTCUSDT", timeframe: "1h" }]);
    // Déjà premier de la liste complète, que le catalogue MEXC retarde de 12 s.
    let liste: unknown;
    void cards!.complets().then((value) => { liste = value; });
    await vi.advanceTimersByTimeAsync(10_999);
    expect(liste).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect((liste as unknown[])[0]).toEqual(cards!.immediats[0]);
  });

  it("à froid, une provenance qui ne confirme pas l'actif n'offre aucun raccourci", async () => {
    vi.stubGlobal("fetch", places({ okx: () => Promise.resolve(response({ code: "0", data: [{ instId: "BTC-USDT", instType: "SPOT", state: "live" }] })) }));
    const routing = await import("./marketRouting");
    const pending = routing.resolveMarketCandidatesProgressifs({ exchange: "okx", symbol: "CARDSUSDT", timeframe: "1h" });
    await vi.advanceTimersByTimeAsync(0);
    expect((await pending).immediats).toEqual([]);
  });

  it("à froid, le perp attend seulement Hyperliquid, garde sa casse native et vérifie l'unité de temps", async () => {
    vi.stubGlobal("fetch", places({ hl: ["kPEPE"] }));
    const routing = await import("./marketRouting");
    const { hyperliquidCoin } = await import("./symbol");
    const pending = routing.resolveMarketCandidatesProgressifs({ symbol: "KPEPE-PERP", timeframe: "1h" });
    await vi.advanceTimersByTimeAsync(0);
    expect((await pending).immediats).toEqual([{ exchange: "hyperliquid", symbol: "KPEPE-PERP", timeframe: "1h" }]);
    expect(hyperliquidCoin("KPEPE-PERP")).toBe("kPEPE");
    // 6h n'existe pas chez Hyperliquid : pas de raccourci, la liste complète ajuste en 1h.
    const sixHeures = await routing.resolveMarketCandidatesProgressifs({ symbol: "KPEPE-PERP", timeframe: "6h" });
    expect(sixHeures.immediats).toEqual([]);
    const liste = sixHeures.complets();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await liste).toEqual([{ exchange: "hyperliquid", symbol: "KPEPE-PERP", timeframe: "1h" }]);
  });

  it("catalogue en cache, même expiré : liste complète immédiate ; les replis suivent son rafraîchissement", async () => {
    vi.stubGlobal("fetch", places({ okx: () => Promise.resolve(response({ code: "0", data: [{ instId: "BTC-USDT", instType: "SPOT", state: "live" }] })) }));
    const routing = await import("./marketRouting");
    const catalog = await routing.fetchMarketCatalog();
    await vi.advanceTimersByTimeAsync(300_000);
    const identity = { exchange: "okx" as const, symbol: "BTCUSDT", timeframe: "1h" as const };
    const { immediats, complets } = await routing.resolveMarketCandidatesProgressifs(identity);
    expect(immediats).toEqual(await routing.resolveMarketCandidates(identity, catalog));
    expect(immediats.map((c) => c.exchange).slice(0, 2)).toEqual(["binance", "okx"]);
    // Rafraîchissement au contenu identique : même liste, recalculée sur le catalogue renouvelé.
    expect(await complets()).toEqual(immediats);
  });

  it("synthétiques et TradFi restent résolus sans catalogue", async () => {
    const fetch = vi.fn(muet);
    vi.stubGlobal("fetch", fetch);
    const routing = await import("./marketRouting");
    for (const identity of [{ symbol: "AAPL", timeframe: "1d" as const }, { symbol: "TOTAL", timeframe: "1d" as const }]) {
      const { immediats, complets } = await routing.resolveMarketCandidatesProgressifs(identity);
      expect(immediats).toEqual(await routing.resolveMarketCandidates(identity, { instruments: [], unavailableSources: [] }));
      expect(immediats).toHaveLength(1);
      expect(await complets()).toEqual(immediats);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("ratio dont l'unité est retirée (grille Twelve Data à :30) : l'unité suivante, jamais la minute", () => {
  it.each([["4h", "1d"], ["1h", "1d"], ["30m", "1d"], ["15m", "15m"]] as const)("÷SPY demandé en %s → %s", async (demandee, attendue) => {
    expect(await resolveMarketCandidates({ exchange: "synthetic", symbol: "binance:BTCUSDT|/|twelvedata:SPY", timeframe: demandee }))
      .toEqual([{ exchange: "synthetic", symbol: "binance:BTCUSDT|/|twelvedata:SPY", timeframe: attendue }]);
  });
});

describe("Twelve Data au numérateur (sondé toutes les 5 min) : le 1m devient 5m", () => {
  it("GLD÷BTC demandé en 1m → 5m", async () => {
    expect(await resolveMarketCandidates({ exchange: "synthetic", symbol: "twelvedata:GLD|/|binance:BTCUSDT", timeframe: "1m" }))
      .toEqual([{ exchange: "synthetic", symbol: "twelvedata:GLD|/|binance:BTCUSDT", timeframe: "5m" }]);
  });
});
