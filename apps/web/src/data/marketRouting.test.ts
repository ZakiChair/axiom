import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Candle, ExchangeId, Timeframe } from "@axiom/types";
import { resolveMarketCandidates, searchMarkets, type MarketCatalog } from "./marketRouting";
import * as profondeur from "./profondeurHistorique";

// Hors des blocs dédiés, la profondeur reste inconnue : aucune sonde réseau réelle.
beforeEach(() => { vi.spyOn(profondeur, "mesurerProfondeurs").mockResolvedValue(); });
afterEach(() => { vi.restoreAllMocks(); });
/** Module neuf (après `vi.resetModules`) sans sonde de profondeur : ordre à profondeur inconnue. */
async function sansSondes() {
  vi.spyOn(await import("./profondeurHistorique"), "mesurerProfondeurs").mockResolvedValue();
}

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
  it("à profondeur inconnue, Binance confirmé passe devant une provenance héritée, qui départage ensuite les replis ; anciens HL migrés", async () => {
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

describe("à profondeur égale ou inconnue, Binance (split taker) passe devant la provenance courante", () => {
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
  beforeEach(async () => { vi.resetModules(); vi.useFakeTimers(); await sansSondes(); });
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

describe("résolution progressive : Binance attendu, les autres places jusqu'à l'échéance commune", () => {
  beforeEach(async () => { vi.resetModules(); vi.useFakeTimers(); await sansSondes(); });
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

  it.each(["binance", "okx"] as const)("à froid, %s:BTCUSDT part sur Binance à l'échéance de 2,5 s malgré une place muette", async (exchange) => {
    // Règle du 26/09 : les autres catalogues spot sont attendus jusqu'à 2,5 s (OKX muet ici).
    vi.stubGlobal("fetch", places());
    const routing = await import("./marketRouting");
    let resolu: Awaited<ReturnType<typeof routing.resolveMarketCandidatesProgressifs>> | undefined;
    void routing.resolveMarketCandidatesProgressifs({ exchange, symbol: "BTCUSDT", timeframe: "1h" }).then((value) => { resolu = value; });
    await vi.advanceTimersByTimeAsync(2_499);
    expect(resolu).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(resolu?.immediats).toEqual([{ exchange: "binance", symbol: "BTCUSDT", timeframe: "1h" }]);
    let complets: unknown;
    void resolu!.complets().then((value) => { complets = value; });
    await vi.advanceTimersByTimeAsync(9_499);
    expect(complets).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    // Liste complète habituelle : Binance d'abord, places sans catalogue en essais spéculatifs.
    expect((complets as Array<{ exchange: string; speculative?: true }>)[0]).toEqual({ exchange: "binance", symbol: "BTCUSDT", timeframe: "1h" });
    expect((complets as Array<{ exchange: string; speculative?: true }>).slice(1).every((c) => c.speculative)).toBe(true);
  });

  it("à froid, CARDSUSDT (OKX seul) confirmé avant l'échéance part sur OKX dès que tous les catalogues ont répondu", async () => {
    vi.stubGlobal("fetch", places({ okx: () => new Promise((resolve) => setTimeout(() => resolve(response({ code: "0", data: [{ instId: "CARDS-USDT", instType: "SPOT", state: "live" }] })), 1_000)) }));
    const routing = await import("./marketRouting");
    let resolu: Awaited<ReturnType<typeof routing.resolveMarketCandidatesProgressifs>> | undefined;
    void routing.resolveMarketCandidatesProgressifs({ exchange: "binance", symbol: "CARDSUSDT", timeframe: "1h" }).then((value) => { resolu = value; });
    await vi.advanceTimersByTimeAsync(999);
    expect(resolu).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(resolu?.immediats).toEqual([{ exchange: "okx", symbol: "CARDSUSDT", timeframe: "1h" }]);
    expect((await resolu!.complets())[0]).toEqual({ exchange: "okx", symbol: "CARDSUSDT", timeframe: "1h" });
  });

  it("à froid, les catalogues arrivés avant l'échéance comptent, une place muette non", async () => {
    // OKX répond en 1 s ; MEXC se tait (délai du catalogue : 12 s) ; les autres échouent.
    const reseau = places({ okx: () => new Promise((resolve) => setTimeout(() => resolve(response({ code: "0", data: [{ instId: "CARDS-USDT", instType: "SPOT", state: "live" }, { instId: "BTC-USDT", instType: "SPOT", state: "live" }] })), 1_000)) });
    vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("mexc") ? muet() : reseau(url)));
    const routing = await import("./marketRouting");
    type Progressifs = Awaited<ReturnType<typeof routing.resolveMarketCandidatesProgressifs>>;
    let cards: Progressifs | undefined;
    let btc: Progressifs | undefined;
    void routing.resolveMarketCandidatesProgressifs({ exchange: "okx", symbol: "CARDSUSDT", timeframe: "1h" }).then((value) => { cards = value; });
    void routing.resolveMarketCandidatesProgressifs({ exchange: "okx", symbol: "BTCUSDT", timeframe: "1h" }).then((value) => { btc = value; });
    await vi.advanceTimersByTimeAsync(2_500);
    expect(cards?.immediats).toEqual([{ exchange: "okx", symbol: "CARDSUSDT", timeframe: "1h" }]);
    // Profondeur inconnue : Binance départage, la provenance OKX suit.
    expect(btc?.immediats).toEqual([{ exchange: "binance", symbol: "BTCUSDT", timeframe: "1h" }, { exchange: "okx", symbol: "BTCUSDT", timeframe: "1h" }]);
    // Déjà premier de la liste complète, que le catalogue MEXC retarde jusqu'à 12 s.
    let liste: unknown;
    void cards!.complets().then((value) => { liste = value; });
    await vi.advanceTimersByTimeAsync(9_499);
    expect(liste).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect((liste as unknown[])[0]).toEqual(cards!.immediats[0]);
  });

  it("à froid, okx:CARDSUSDT au catalogue OKX lent : sa provenance est attendue au-delà de l'échéance, pas le catalogue muet", async () => {
    // OKX répond en 4 s ; MEXC se tait (délai du catalogue : 12 s) ; les autres échouent.
    const reseau = places({ okx: () => new Promise((resolve) => setTimeout(() => resolve(response({ code: "0", data: [{ instId: "CARDS-USDT", instType: "SPOT", state: "live" }] })), 4_000)) });
    vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("mexc") ? muet() : reseau(url)));
    const routing = await import("./marketRouting");
    let resolu: Awaited<ReturnType<typeof routing.resolveMarketCandidatesProgressifs>> | undefined;
    void routing.resolveMarketCandidatesProgressifs({ exchange: "okx", symbol: "CARDSUSDT", timeframe: "1h" }).then((value) => { resolu = value; });
    await vi.advanceTimersByTimeAsync(3_999);
    expect(resolu).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(resolu?.immediats).toEqual([{ exchange: "okx", symbol: "CARDSUSDT", timeframe: "1h" }]);
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

/*
 * Règle du 26/09/2026 : la place qui affiche le plus d'historique passe devant ; Binance ne
 * départage plus qu'à profondeur équivalente. Cache de profondeur pré-rempli (localStorage
 * bouchonné) ou sondes simulées sur les adaptateurs ; horloge figée, aucun réseau.
 */
const JOUR = 86_400_000;
const SEMAINE = 7 * JOUR;
const MAINTENANT = Date.parse("2026-09-26T08:00:00Z");
const date = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const serie = (debut: number, n: number, pas = SEMAINE): Candle[] => Array.from({ length: n }, (_, i) => ({ time: debut + i * pas, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
const spot = (...entrees: Array<[ExchangeId, string]>): MarketCatalog => ({ instruments: entrees.map(([exchange, symbol]) => ({ exchange, symbol, kind: "spot" as const })), unavailableSources: [] });
const HYPE = spot(["binance", "HYPEUSDT"], ["bybit", "HYPEUSDT"], ["okx", "HYPEUSDT"]);
const BTC = spot(["binance", "BTCUSDT"], ["bybit", "BTCUSDT"], ["okx", "BTCUSDT"]);
const BTCUSD = spot(["kraken", "BTCUSD"], ["coinbase", "BTCUSD"]);
const HYPEUSD = spot(["kraken", "HYPEUSD"], ["coinbase", "HYPEUSD"]);
type Profondeurs = Record<string, [number, 0 | 1]>;
/** Premières bougies mesurées le 26/09/2026 (Binance HYPEUSDT n'a pas une semaine). */
const P_HYPE: Profondeurs = { "binance:HYPEUSDT": [date("2026-09-24"), 1], "bybit:HYPEUSDT": [date("2025-07-11"), 1], "okx:HYPEUSDT": [date("2025-11-04"), 1] };
const P_BTC: Profondeurs = { "binance:BTCUSDT": [date("2017-08-17"), 1], "bybit:BTCUSDT": [date("2021-07-05"), 1], "okx:BTCUSDT": [MAINTENANT - 299 * SEMAINE, 0] };
const P_BTCUSD: Profondeurs = { "kraken:BTCUSD": [MAINTENANT - 719 * SEMAINE, 0], "coinbase:BTCUSD": [MAINTENANT - 1_400 * JOUR, 0] };
const P_HYPEUSD: Profondeurs = { "kraken:HYPEUSD": [date("2026-01-22"), 1], "coinbase:HYPEUSD": [date("2026-02-05"), 1] };
const PLACES = ["binance", "kraken", "coinbase", "bybit", "okx", "mexc", "hyperliquid", "twelvedata", "synthetic"] as const;
type Sondes = Partial<Record<ExchangeId, (symbol: string, timeframe: Timeframe, opts?: { limit?: number; endTime?: number }) => Promise<Candle[]>>>;

/** Routage neuf : cache de profondeur pré-rempli (mesuré à l'instant) et sondes espionnées (échec par défaut). */
async function routage(profondeurs: Profondeurs = {}, sondes: Sondes = {}) {
  const e = Object.fromEntries(Object.entries(profondeurs).map(([cle, [debut, exact]]) => [cle, [debut, exact, MAINTENANT]]));
  vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ v: 1, e }), setItem: () => {} });
  const { getAdapter } = await import("./adapters");
  const espions = Object.fromEntries(PLACES.map((place) => [place, vi.spyOn(getAdapter(place), "fetchKlines")
    .mockImplementation((symbol, timeframe, opts) => (sondes[place] ?? (() => Promise.reject(new Error("sonde en échec"))))(symbol, timeframe, opts))]));
  const routing = await import("./marketRouting");
  const ordre = async (identity: { exchange?: ExchangeId; symbol: string; timeframe: Timeframe }, catalog: MarketCatalog) =>
    (await routing.resolveMarketCandidates(identity, catalog)).map((c) => `${c.exchange}${c.speculative ? "?" : ""}`);
  const appels = () => Object.values(espions).reduce((total, espion) => total + espion.mock.calls.length, 0);
  return { routing, espions, ordre, appels };
}

describe("profondeur d'historique : la place qui affiche le plus d'historique passe devant", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(MAINTENANT);
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("réseau interdit en test"))));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it.each(["1h", "1d"] as const)("HYPEUSDT en %s : Bybit d'abord, puis OKX, Binance (moins d'une semaine) en dernier recours", async (timeframe) => {
    const { ordre, appels } = await routage(P_HYPE);
    expect(await ordre({ symbol: "HYPEUSDT", timeframe }, HYPE)).toEqual(["bybit", "okx", "binance"]);
    expect(await ordre({ exchange: "binance", symbol: "HYPEUSDT", timeframe }, HYPE)).toEqual(["bybit", "okx", "binance"]);
    expect(appels()).toBe(0);
  });

  it.each(["1m", "1h", "1d"] as const)("BTCUSDT en %s : Binance (2017) reste premier, provenance OKX comprise", async (timeframe) => {
    const { ordre } = await routage(P_BTC);
    expect((await ordre({ symbol: "BTCUSDT", timeframe }, BTC))[0]).toBe("binance");
    expect((await ordre({ exchange: "okx", symbol: "BTCUSDT", timeframe }, BTC))[0]).toBe("binance");
  });

  it.each([
    ["2026-09-28T12:00:00Z", "bybit"], ["2026-10-07T00:00:00Z", "bybit"],
    // Binance couvre alors toute la fenêtre 1m du graphe (~13,9 j) : équivalent, il départage.
    ["2026-10-08T00:00:00Z", "binance"],
  ] as const)("HYPEUSDT en 1m le %s : %s en tête (tolérance à 5 % de la fenêtre, pas 7 jours)", async (instant, attendu) => {
    const { ordre } = await routage(P_HYPE);
    vi.setSystemTime(Date.parse(instant));
    expect((await ordre({ exchange: "bybit", symbol: "HYPEUSDT", timeframe: "1m" }, HYPE))[0]).toBe(attendu);
    expect((await ordre({ symbol: "HYPEUSDT", timeframe: "1m" }, HYPE))[0]).toBe(attendu);
  });

  it("BTCUSDT en 1m : Bybit équivalent à Binance (plafond du graphe), OKX limité à 1 440 bougies en dernier", async () => {
    const { ordre } = await routage(P_BTC);
    expect(await ordre({ exchange: "okx", symbol: "BTCUSDT", timeframe: "1m" }, BTC)).toEqual(["binance", "bybit", "okx"]);
  });

  it.each(["1d", "1h"] as const)("BTCUSD en %s : Coinbase devant Kraken (500 bougies affichées seulement)", async (timeframe) => {
    const { ordre } = await routage(P_BTCUSD);
    expect(await ordre({ symbol: "BTCUSD", timeframe }, BTCUSD)).toEqual(["coinbase", "kraken"]);
    expect(await ordre({ exchange: "kraken", symbol: "BTCUSD", timeframe }, BTCUSD)).toEqual(["coinbase", "kraken"]);
  });

  it("HYPEUSD limité à Kraken et Coinbase : Kraken (2026-01-22) en 1d, Coinbase en 1h où Kraken ne couvre que 500 heures", async () => {
    const { ordre } = await routage(P_HYPEUSD);
    expect(await ordre({ symbol: "HYPEUSD", timeframe: "1d" }, HYPEUSD)).toEqual(["kraken", "coinbase"]);
    expect(await ordre({ symbol: "HYPEUSD", timeframe: "1h" }, HYPEUSD)).toEqual(["coinbase", "kraken"]);
  });

  it("HYPEUSD sur API réelles (OKX coté le 04/11/2025) : OKX en 1d, Coinbase en 1h où OKX ne couvre que 1 440 heures", async () => {
    const { ordre } = await routage({ ...P_HYPEUSD, "okx:HYPEUSD": [date("2025-11-03"), 1] });
    const catalogue = spot(["kraken", "HYPEUSD"], ["coinbase", "HYPEUSD"], ["okx", "HYPEUSD"]);
    expect(await ordre({ symbol: "HYPEUSD", timeframe: "1d" }, catalogue)).toEqual(["okx", "kraken", "coinbase"]);
    expect(await ordre({ symbol: "HYPEUSD", timeframe: "1h" }, catalogue)).toEqual(["coinbase", "okx", "kraken"]);
  });

  it("Kraken plafonné à 500 bougies (backfill sans pagination) : PEPEUSD en 1d, Coinbase et OKX devant Kraken pourtant coté plus tôt", async () => {
    const { ordre } = await routage({ "kraken:PEPEUSD": [date("2023-05-11"), 1], "coinbase:PEPEUSD": [date("2024-11-13"), 1], "okx:PEPEUSD": [date("2025-01-13"), 1] });
    expect(await ordre({ symbol: "PEPEUSD", timeframe: "1d" }, spot(["kraken", "PEPEUSD"], ["coinbase", "PEPEUSD"], ["okx", "PEPEUSD"])))
      .toEqual(["coinbase", "okx", "kraken"]);
  });

  it("une borne (exact:false) est « au moins aussi profonde » : Coinbase BTCEUR arrêté à 4 pages reste au palier de tête, Binance départage", async () => {
    const { ordre } = await routage({
      "binance:BTCEUR": [date("2019-12-30"), 1], "coinbase:BTCEUR": [MAINTENANT - 1_400 * JOUR, 0],
      // Borne déjà plus ancienne que Binance au-delà de la tolérance : prouvée plus profonde.
      "binance:XLMEUR": [date("2023-02-10"), 1], "coinbase:XLMEUR": [MAINTENANT - 1_400 * JOUR, 0],
    });
    for (const timeframe of ["1d", "6h", "4h"] as const) {
      expect(await ordre({ exchange: "coinbase", symbol: "BTCEUR", timeframe }, spot(["binance", "BTCEUR"], ["coinbase", "BTCEUR"]))).toEqual(["binance", "coinbase"]);
    }
    expect(await ordre({ symbol: "XLMEUR", timeframe: "1d" }, spot(["binance", "XLMEUR"], ["coinbase", "XLMEUR"]))).toEqual(["coinbase", "binance"]);
  });

  it("une borne n'est jamais reléguée par un début exact plus ancien qu'elle : Coinbase BTCUSDC (réel : 2015) reste devant Bybit hors Binance", async () => {
    const { ordre } = await routage({ "bybit:BTCUSDC": [date("2021-07-05"), 1], "coinbase:BTCUSDC": [MAINTENANT - 1_400 * JOUR, 0] });
    const catalogue = spot(["coinbase", "BTCUSDC"], ["bybit", "BTCUSDC"]);
    expect(await ordre({ symbol: "BTCUSDC", timeframe: "1d" }, catalogue)).toEqual(["coinbase", "bybit"]);
    expect(await ordre({ exchange: "bybit", symbol: "BTCUSDC", timeframe: "1d" }, catalogue)).toEqual(["bybit", "coinbase"]);
    // En 1h, la fenêtre de 20 000 bougies est couverte par les deux : l'ordre des sources départage.
    expect(await ordre({ symbol: "BTCUSDC", timeframe: "1h" }, catalogue)).toEqual(["coinbase", "bybit"]);
  });

  it("une place sans mesure garde le doute jusqu'au plafond de sa place seulement : Kraken inconnu ne passe pas devant Coinbase (BTCUSD 1d), même en provenance", async () => {
    const { ordre } = await routage({ "coinbase:BTCUSD": [MAINTENANT - 1_400 * JOUR, 0] });
    expect(await ordre({ exchange: "kraken", symbol: "BTCUSD", timeframe: "1d" }, BTCUSD)).toEqual(["coinbase", "kraken"]);
  });

  it("une place sans l'unité demandée ne fixe pas le palier des autres : BTCUSDT en 1w, Coinbase (sans 1w) coté plus tôt ne fait pas passer Bybit, 3 jours avant Binance, devant lui", async () => {
    const { ordre } = await routage({ "binance:BTCUSDT": [date("2017-08-17"), 1], "bybit:BTCUSDT": [date("2017-08-14"), 1], "coinbase:BTCUSDT": [date("2015-01-05"), 1] });
    const catalogue = spot(["binance", "BTCUSDT"], ["coinbase", "BTCUSDT"], ["bybit", "BTCUSDT"]);
    expect(await ordre({ symbol: "BTCUSDT", timeframe: "1w" }, catalogue)).toEqual(["binance", "bybit", "coinbase"]);
    // En 1d, Coinbase sert l'unité : son historique plus ancien le place devant.
    expect(await ordre({ symbol: "BTCUSDT", timeframe: "1d" }, catalogue)).toEqual(["coinbase", "bybit", "binance"]);
  });

  it("sondes simulées : HYPEUSDT mesuré une fois par place (1w affiné en 1d si la cotation est récente ; OKX 1M affiné au lundi), puis classé par profondeur", async () => {
    const { ordre, espions } = await routage({}, {
      binance: async () => serie(date("2026-09-24"), 1), bybit: async () => serie(date("2025-07-11"), 64), okx: async () => serie(date("2025-11-04"), 47),
    });
    expect(await ordre({ exchange: "binance", symbol: "HYPEUSDT", timeframe: "1h" }, HYPE)).toEqual(["bybit", "okx", "binance"]);
    expect(await ordre({ symbol: "HYPEUSDT", timeframe: "1d" }, HYPE)).toEqual(["bybit", "okx", "binance"]);
    for (const place of ["binance", "bybit"] as const) {
      expect(espions[place]!.mock.calls).toEqual([["HYPEUSDT", "1w", { limit: 1_000 }], ["HYPEUSDT", "1d", { limit: 1_000 }]]);
    }
    // OKX (04/11/2025) est hors de portée d'une sonde 1d de 300 bougies : page 1w autour du mois.
    expect(espions.okx!.mock.calls).toEqual([["HYPEUSDT", "1M", { limit: 300 }], ["HYPEUSDT", "1w", { limit: 6, endTime: date("2025-11-04") + 5 * SEMAINE }]]);
  });

  it("toutes les sondes en échec : ordre actuel (Binance confirmé en tête), sans nouvelle sonde pendant 60 s", async () => {
    const { ordre, appels } = await routage();
    expect(await ordre({ symbol: "HYPEUSDT", timeframe: "1h" }, HYPE)).toEqual(["binance", "bybit", "okx"]);
    expect(await ordre({ exchange: "okx", symbol: "HYPEUSDT", timeframe: "1h" }, HYPE)).toEqual(["binance", "okx", "bybit"]);
    expect(appels()).toBe(3);
  });

  it("mesure bornée à 2,5 s : des sondes muettes redonnent l'ordre actuel à l'échéance", async () => {
    const { routing } = await routage({}, { binance: () => new Promise(() => {}), bybit: () => new Promise(() => {}), okx: () => new Promise(() => {}) });
    let ordre: string[] | undefined;
    void routing.resolveMarketCandidates({ symbol: "HYPEUSDT", timeframe: "1h" }, HYPE).then((liste) => { ordre = liste.map((c) => c.exchange); });
    await vi.advanceTimersByTimeAsync(2_499);
    expect(ordre).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(ordre).toEqual(["binance", "bybit", "okx"]);
  });

  it("une profondeur connue face à une inconnue : bénéfice du doute, l'inconnue ne perd pas la tête", async () => {
    const { ordre } = await routage({ "bybit:HYPEUSDT": [date("2025-07-11"), 1], "okx:HYPEUSDT": [date("2025-11-04"), 1] });
    // Binance inconnu (sonde en échec) : palier de tête avec Bybit, départagé en faveur de Binance.
    expect(await ordre({ symbol: "HYPEUSDT", timeframe: "1d" }, HYPE)).toEqual(["binance", "bybit", "okx"]);
  });

  it("une place « vide » passe après toutes les autres", async () => {
    const { ordre } = await routage({ "bybit:HYPEUSDT": [date("2025-07-11"), 1] }, { binance: async () => [], okx: async () => serie(date("2025-11-04"), 47) });
    expect(await ordre({ symbol: "HYPEUSDT", timeframe: "1d" }, HYPE)).toEqual(["bybit", "okx", "binance"]);
  });

  it("un essai spéculatif utilise aussi le cache : la provenance Binance restaurée ne garde plus la tête si elle est moins profonde", async () => {
    const { ordre } = await routage(P_HYPE);
    const binanceKo: MarketCatalog = { unavailableSources: ["binance"], instruments: HYPE.instruments.filter((c) => c.exchange !== "binance") };
    expect(await ordre({ exchange: "binance", symbol: "HYPEUSDT", timeframe: "1h" }, binanceKo)).toEqual(["bybit", "okx", "binance?"]);
  });

  it("CARDSUSDT (OKX seul), BTC-PERP, GLD (TradFi) et TOTAL : aucune sonde", async () => {
    const { routing, appels } = await routage();
    const catalogue: MarketCatalog = { unavailableSources: [], instruments: [
      { exchange: "okx", symbol: "CARDSUSDT", kind: "spot" }, { exchange: "hyperliquid", symbol: "BTC-PERP", kind: "perp" },
      { exchange: "twelvedata", symbol: "GLD", kind: "tradfi" },
    ] };
    for (const identity of [
      { symbol: "CARDSUSDT" }, { symbol: "BTC-PERP" }, { exchange: "twelvedata" as const, symbol: "GLD" }, { symbol: "TOTAL" },
    ]) expect(await routing.resolveMarketCandidates({ ...identity, timeframe: "1d" }, catalogue)).toHaveLength(1);
    expect(appels()).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("sortie anticipée : la mesure rend dès que la tête ne peut plus changer", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(MAINTENANT);
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("réseau interdit en test"))));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  const muette = () => new Promise<Candle[]>(() => {});
  const BTC_CB = spot(["binance", "BTCUSDT"], ["coinbase", "BTCUSDT"], ["bybit", "BTCUSDT"], ["okx", "BTCUSDT"]);

  it.each(["1m", "1h"] as const)("BTCUSDT en %s : Binance mesuré au plafond du graphe, décidé sans attendre Coinbase muet", async (timeframe) => {
    const { routing, espions } = await routage({}, { binance: async () => serie(date("2017-08-14"), 476), coinbase: muette, bybit: muette, okx: muette });
    let ordre: string[] | undefined;
    void routing.resolveMarketCandidates({ exchange: "coinbase", symbol: "BTCUSDT", timeframe }, BTC_CB).then((liste) => { ordre = liste.map((c) => c.exchange); });
    await vi.advanceTimersByTimeAsync(0);
    expect(ordre).toEqual(["binance", "coinbase", "bybit", "okx"]);
    // Les sondes parties finissent en fond ; aucune n'a été attendue.
    expect(espions.coinbase).toHaveBeenCalledTimes(1);
  });

  it("BTCUSDT en 1d : Coinbase (sans plafond) pourrait être plus profond que Binance 2017, il est attendu jusqu'à la borne", async () => {
    const { routing } = await routage({}, { binance: async () => serie(date("2017-08-14"), 476), coinbase: muette, bybit: muette, okx: muette });
    let ordre: string[] | undefined;
    void routing.resolveMarketCandidates({ symbol: "BTCUSDT", timeframe: "1d" }, BTC_CB).then((liste) => { ordre = liste.map((c) => c.exchange); });
    await vi.advanceTimersByTimeAsync(2_499);
    expect(ordre).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(ordre).toEqual(["binance", "coinbase", "bybit", "okx"]);
  });

  it("BTCUSDT en 1w : Coinbase (sans 1w) ne peut pas passer en tête, décidé sans attendre sa sonde muette", async () => {
    const { routing, espions } = await routage({}, { binance: async () => serie(date("2017-08-14"), 476), bybit: async () => serie(date("2021-07-05"), 273), coinbase: muette });
    let ordre: string[] | undefined;
    void routing.resolveMarketCandidates({ symbol: "BTCUSDT", timeframe: "1w" }, spot(["binance", "BTCUSDT"], ["coinbase", "BTCUSDT"], ["bybit", "BTCUSDT"])).then((liste) => { ordre = liste.map((c) => c.exchange); });
    await vi.advanceTimersByTimeAsync(0);
    expect(ordre).toEqual(["binance", "bybit", "coinbase"]);
    expect(espions.coinbase).toHaveBeenCalledTimes(1);
  });

  it("HYPEUSDT en 1d : OKX attendu tant qu'il peut passer devant Bybit", async () => {
    const { routing } = await routage({}, {
      binance: async () => serie(date("2026-09-24"), 1), bybit: async () => serie(date("2025-07-11"), 64),
      // OKX répond en 1,5 s ; la page 1w d'affinage aussitôt.
      okx: (_symbol, tf) => tf === "1M" ? new Promise((ok) => setTimeout(() => ok(serie(date("2025-11-01"), 11, 30 * JOUR)), 1_500)) : Promise.resolve(serie(date("2025-11-03"), 5)),
    });
    let ordre: string[] | undefined;
    void routing.resolveMarketCandidates({ exchange: "binance", symbol: "HYPEUSDT", timeframe: "1d" }, HYPE).then((liste) => { ordre = liste.map((c) => c.exchange); });
    await vi.advanceTimersByTimeAsync(1_499);
    expect(ordre).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(ordre).toEqual(["bybit", "okx", "binance"]);
  });

  it("HYPEUSDT en 1h : OKX (1 440 bougies au plus) ne peut plus passer devant Bybit, décidé sans lui", async () => {
    const { routing } = await routage({}, { binance: async () => serie(date("2026-09-24"), 1), bybit: async () => serie(date("2025-07-11"), 64), okx: muette });
    let ordre: string[] | undefined;
    void routing.resolveMarketCandidates({ exchange: "binance", symbol: "HYPEUSDT", timeframe: "1h" }, HYPE).then((liste) => { ordre = liste.map((c) => c.exchange); });
    await vi.advanceTimersByTimeAsync(0);
    expect(ordre).toEqual(["bybit", "okx", "binance"]);
  });

  it("HYPEUSDT : tête inconnue (Binance muet, bénéfice du doute) jamais décidée avant la borne", async () => {
    const { routing } = await routage({}, { binance: muette, bybit: async () => serie(date("2025-07-11"), 64), okx: async () => serie(date("2025-11-03"), 47) });
    let ordre: string[] | undefined;
    void routing.resolveMarketCandidates({ symbol: "HYPEUSDT", timeframe: "1h" }, HYPE).then((liste) => { ordre = liste.map((c) => c.exchange); });
    await vi.advanceTimersByTimeAsync(2_499);
    expect(ordre).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(ordre).toEqual(["binance", "bybit", "okx"]);
  });

  it("12 résultats de recherche en file chez Binance, Bybit et OKX : la sonde du graphe passe devant, Bybit en tête sous la borne ; la recherche abandonnée ne sonde plus", async () => {
    const RECHERCHE = ["HYPERUSDT", "HBARUSDT", "HOOKUSDT", "HOTUSDT", "HIGHUSDT", "HIFIUSDT", "HMSTRUSDT", "HAEDALUSDT", "HFTUSDT", "HIVEUSDT", "HOMEUSDT", "HYPEUSDT"];
    /** 500 ms par requête ; paires anciennes sans affinage, HYPEUSDT comme sur API réelles. */
    const place = (hype: (tf: Timeframe) => Candle[]) => (symbol: string, tf: Timeframe) =>
      new Promise<Candle[]>((ok) => setTimeout(() => ok(symbol === "HYPEUSDT" ? hype(tf) : serie(date("2020-01-06"), 300)), 500));
    const { routing, espions } = await routage({}, {
      binance: place((tf) => tf === "1w" ? serie(date("2026-09-21"), 1) : serie(date("2026-09-24"), 3, JOUR)),
      bybit: place((tf) => tf === "1w" ? serie(date("2025-07-07"), 64) : serie(date("2025-07-11"), 443, JOUR)),
      okx: place((tf) => tf === "1M" ? serie(date("2025-11-01"), 11, 30 * JOUR) : serie(date("2025-11-03"), 5)),
    });
    const profondeur = await import("./profondeurHistorique");
    const recherche = new AbortController();
    for (const symbol of RECHERCHE) {
      void profondeur.mesurerProfondeurs((["binance", "bybit", "okx"] as const).map((exchange) => ({ exchange, symbol })), 2_500, { priorite: "recherche", signal: recherche.signal });
    }
    let ordre: string[] | undefined;
    void routing.resolveMarketCandidates({ symbol: "HYPEUSDT", timeframe: "1h" }, HYPE).then((liste) => { ordre = liste.map((c) => c.exchange); });
    // Sans priorité, HYPEUSDT (12e) partirait après cinq tours de 500 ms : Binance resterait inconnu à la borne.
    await vi.advanceTimersByTimeAsync(900);
    // La requête de recherche change : ses sondes encore en file sont retirées (HYPEUSDT, attendue par le graphe, reste).
    recherche.abort();
    await vi.advanceTimersByTimeAsync(100);
    expect(ordre).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(ordre).toEqual(["bybit", "okx", "binance"]);
    await vi.advanceTimersByTimeAsync(10_000);
    // La recherche n'occupe qu'un des deux créneaux (l'autre reste au graphe) : seule HYPERUSDT,
    // en tête de sa file, est partie avant l'abandon.
    for (const exchange of ["binance", "bybit", "okx"] as const) {
      expect(new Set(espions[exchange]!.mock.calls.map(([symbol]) => symbol))).toEqual(new Set(["HYPERUSDT", "HYPEUSDT"]));
    }
  });

  it.each([true, false])("frappe « HYPE » (cotations récentes, 2 requêtes par sonde), Binance à 1 s par requête, clic sur HYPEUSDT (liste fermée : %s) : Bybit en tête sous la borne", async (fermee) => {
    const RECHERCHE = ["HYPERUSDT", "HYPETRY", "HYPEUSDC", "HYPEUSDT"];
    /** HYPEUSDT comme sur API réelles ; les autres paires cotées le 02/03/2026 (1w puis affinage 1d). */
    const place = (ms: number, hype: (tf: Timeframe) => Candle[]) => (symbol: string, tf: Timeframe) =>
      new Promise<Candle[]>((ok) => setTimeout(() => ok(symbol === "HYPEUSDT" ? hype(tf) : tf === "1d" ? serie(date("2026-03-02"), 208, JOUR) : tf === "1M" ? serie(date("2026-03-01"), 7, 30 * JOUR) : serie(date("2026-03-02"), 30)), ms));
    const { routing } = await routage({}, {
      binance: place(1_000, (tf) => tf === "1w" ? serie(date("2026-09-21"), 1) : serie(date("2026-09-24"), 3, JOUR)),
      bybit: place(345, (tf) => tf === "1w" ? serie(date("2025-07-07"), 64) : serie(date("2025-07-11"), 443, JOUR)),
      okx: place(540, (tf) => tf === "1M" ? serie(date("2025-11-01"), 11, 30 * JOUR) : serie(date("2025-11-03"), 5)),
    });
    const profondeur = await import("./profondeurHistorique");
    const recherche = new AbortController();
    for (const symbol of RECHERCHE) {
      void profondeur.mesurerProfondeurs((["binance", "bybit", "okx"] as const).map((exchange) => ({ exchange, symbol })), 2_500, { priorite: "recherche", signal: recherche.signal });
    }
    // Clic 300 ms après le départ de la rafale : une sonde de recherche Binance court encore (2 s).
    await vi.advanceTimersByTimeAsync(300);
    if (fermee) recherche.abort();
    let ordre: string[] | undefined;
    void routing.resolveMarketCandidates({ exchange: "binance", symbol: "HYPEUSDT", timeframe: "1h" }, HYPE).then((liste) => { ordre = liste.map((c) => c.exchange); });
    // Sans créneau réservé, le graphe attendrait la fin d'une sonde de recherche (2 s) puis ferait
    // ses 2 requêtes : Binance inconnu à la borne garderait la tête.
    await vi.advanceTimersByTimeAsync(1_999);
    expect(ordre).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(ordre).toEqual(["bybit", "okx", "binance"]);
  });

  it("clic sur HYPEUSD en 1d derrière des sondes de recherche en cours (Coinbase 4 pages à 700 ms, Kraken 2 requêtes à 800 ms) : le graphe prend le second créneau, OKX en tête sous la borne", async () => {
    const lente = (ms: number, bougies: (symbol: string, tf: Timeframe, opts?: { endTime?: number }) => Candle[]) =>
      (symbol: string, tf: Timeframe, opts?: { endTime?: number }) => new Promise<Candle[]>((ok) => setTimeout(() => ok(bougies(symbol, tf, opts)), ms));
    const { routing } = await routage({}, {
      // HBARUSD coté en 2019 : quatre pages pleines ; HYPEUSD comme sur API réelles (05/02/2026, puis page vide).
      coinbase: lente(700, (symbol, _tf, opts) => symbol !== "HYPEUSD" ? serie((opts?.endTime ?? MAINTENANT) - 350 * JOUR, 350, JOUR)
        : opts?.endTime === undefined ? serie(date("2026-02-05"), 233, JOUR) : []),
      // HYPEEUR et HYPEUSD cotés le 22/01/2026 : 1w, puis affinage 1d dans le même créneau.
      kraken: lente(800, (_symbol, tf) => tf === "1w" ? serie(date("2026-01-19"), 36) : serie(date("2026-01-22"), 248, JOUR)),
      okx: lente(600, (symbol, tf) => symbol === "HYPEUSD"
        ? tf === "1M" ? serie(date("2025-11-01"), 11, 30 * JOUR) : serie(date("2025-11-03"), 5)
        : tf === "1M" ? serie(date("2019-09-01"), 85, 30 * JOUR) : serie(date("2019-09-02"), 6)),
    });
    const profondeur = await import("./profondeurHistorique");
    const recherche = new AbortController();
    void profondeur.mesurerProfondeurs([{ exchange: "coinbase", symbol: "HBARUSD" }, { exchange: "kraken", symbol: "HYPEEUR" }, { exchange: "okx", symbol: "HBARUSD" }], 2_500, { priorite: "recherche", signal: recherche.signal });
    // Clic 300 ms après le départ des sondes de recherche : la liste se ferme.
    await vi.advanceTimersByTimeAsync(300);
    recherche.abort();
    let ordre: string[] | undefined;
    void routing.resolveMarketCandidates({ symbol: "HYPEUSD", timeframe: "1d" }, spot(["kraken", "HYPEUSD"], ["coinbase", "HYPEUSD"], ["okx", "HYPEUSD"]))
      .then((liste) => { ordre = liste.map((c) => c.exchange); });
    // Sans créneau réservé, Coinbase attendrait la fin des 4 pages (2,8 s) et Kraken celle de
    // HYPEEUR (1,6 s) : inconnus à la borne, ils passeraient devant OKX au départage.
    // Coinbase 300 → 1 700 ms, OKX 300 → 1 500 ms, Kraken (espacement 1 s) 1 000 → 2 600 ms.
    await vi.advanceTimersByTimeAsync(2_299);
    expect(ordre).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(ordre).toEqual(["okx", "kraken", "coinbase"]);
  });
});

describe("résolution progressive par profondeur d'historique", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(MAINTENANT);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  const reponse = (value: unknown) => ({ ok: true, json: async () => value });
  const apres = (ms: number, value: unknown) => new Promise((resolve) => setTimeout(() => resolve(reponse(value)), ms));
  /** Catalogues HYPEUSDT de Binance, Bybit, OKX et MEXC après les délais donnés ; les autres échouent. */
  const catalogues = (delais: Partial<Record<"binance" | "bybit" | "okx" | "mexc", number>>) => vi.fn((url: string) => {
    if (url.includes("api.binance.com")) return apres(delais.binance ?? 0, { symbols: [{ symbol: "HYPEUSDT", status: "TRADING" }] });
    if (url.includes("bybit")) return apres(delais.bybit ?? 0, { retCode: 0, result: { list: [{ symbol: "HYPEUSDT", status: "Trading" }] } });
    if (url.includes("okx")) return apres(delais.okx ?? 0, { code: "0", data: [{ instId: "HYPE-USDT", instType: "SPOT", state: "live" }] });
    if (url.includes("mexc")) return apres(delais.mexc ?? 0, { symbols: [{ symbol: "HYPEUSDT", status: "1", isSpotTradingAllowed: true }] });
    return Promise.reject(new Error("indisponible"));
  });
  const SONDES_HYPE: Sondes = {
    binance: async () => serie(date("2026-09-24"), 1), bybit: async () => serie(date("2025-07-11"), 64), okx: async () => serie(date("2025-11-04"), 47), mexc: async () => [],
  };

  type Progressifs = Awaited<ReturnType<typeof import("./marketRouting").resolveMarketCandidatesProgressifs>>;

  it("à froid, cache de profondeur complet : aucun raccourci, les catalogues sont lus ; Bybit part dès leur réponse, sans sonde", async () => {
    const base = catalogues({ bybit: 300, okx: 400 });
    vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("mexc") ? Promise.reject(new Error("indisponible")) : base(url)));
    const { routing, appels } = await routage(P_HYPE);
    let resolu: Progressifs | undefined;
    void routing.resolveMarketCandidatesProgressifs({ exchange: "binance", symbol: "HYPEUSDT", timeframe: "1h" }).then((value) => { resolu = value; });
    await vi.advanceTimersByTimeAsync(399);
    expect(resolu).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(resolu?.immediats.map((c) => c.exchange)).toEqual(["bybit", "okx", "binance"]);
    expect(appels()).toBe(0);
  });

  it.each([undefined, "binance", "okx"] as const)("à froid, paire Binance suspendue mais encore mesurée en cache (STORJUSDT, provenance %s) : catalogue Binance lu, OKX retenu, jamais Binance", async (exchange) => {
    // Binance sert encore des bougies figées d'une paire en BREAK ; son catalogue (TRADING seul) ne la cote plus.
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("api.binance.com")) return apres(0, { symbols: [{ symbol: "STORJUSDT", status: "BREAK" }, { symbol: "BTCUSDT", status: "TRADING" }] });
      if (url.includes("okx")) return apres(300, { code: "0", data: [{ instId: "STORJ-USDT", instType: "SPOT", state: "live" }] });
      return Promise.reject(new Error("indisponible"));
    }));
    const { routing, appels } = await routage({ "binance:STORJUSDT": [date("2019-02-18"), 1], "okx:STORJUSDT": [date("2019-05-20"), 1] });
    let resolu: Progressifs | undefined;
    void routing.resolveMarketCandidatesProgressifs({ exchange, symbol: "STORJUSDT", timeframe: "1d" }).then((value) => { resolu = value; });
    await vi.advanceTimersByTimeAsync(299);
    expect(resolu).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(resolu?.immediats).toEqual([{ exchange: "okx", symbol: "STORJUSDT", timeframe: "1d" }]);
    expect(appels()).toBe(0);
  });

  it.each(["1m", "1h"] as const)("à froid, BTCUSDT en %s : Binance confirmé puis mesuré au plafond du graphe part aussitôt, sans attendre les catalogues muets", async (timeframe) => {
    vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("api.binance.com") ? apres(0, { symbols: [{ symbol: "BTCUSDT", status: "TRADING" }] }) : new Promise(() => {})));
    const { routing, espions } = await routage({}, { binance: async () => serie(date("2017-08-14"), 476) });
    let resolu: Progressifs | undefined;
    void routing.resolveMarketCandidatesProgressifs({ exchange: "okx", symbol: "BTCUSDT", timeframe }).then((value) => { resolu = value; });
    await vi.advanceTimersByTimeAsync(0);
    expect(resolu?.immediats).toEqual([{ exchange: "binance", symbol: "BTCUSDT", timeframe }]);
    expect(espions.binance!.mock.calls).toEqual([["BTCUSDT", "1w", { limit: 1_000 }]]);
    for (const place of ["kraken", "coinbase", "bybit", "okx", "mexc"] as const) expect(espions[place]).not.toHaveBeenCalled();
  });

  it("à froid, BTCUSDT en 1d : Coinbase (sans plafond) pourrait être plus profond que Binance 2017 ; catalogues attendus jusqu'à l'échéance", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("api.binance.com") ? apres(0, { symbols: [{ symbol: "BTCUSDT", status: "TRADING" }] }) : new Promise(() => {})));
    const { routing } = await routage({}, { binance: async () => serie(date("2017-08-14"), 476) });
    let resolu: Progressifs | undefined;
    void routing.resolveMarketCandidatesProgressifs({ exchange: "okx", symbol: "BTCUSDT", timeframe: "1d" }).then((value) => { resolu = value; });
    await vi.advanceTimersByTimeAsync(2_499);
    expect(resolu).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(resolu?.immediats).toEqual([{ exchange: "binance", symbol: "BTCUSDT", timeframe: "1d" }]);
  });

  it("à froid, BTCUSDT en 1d : Binance mesuré est décidé dès que Coinbase, Bybit et MEXC refusent, sans attendre OKX ni Kraken muets (plafonnés)", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("api.binance.com") ? apres(0, { symbols: [{ symbol: "BTCUSDT", status: "TRADING" }] })
      : url.includes("okx") || url.includes("kraken") ? new Promise(() => {})
        : new Promise((_, ko) => setTimeout(() => ko(new Error("indisponible")), 300))));
    const { routing } = await routage({}, { binance: async () => serie(date("2017-08-14"), 476) });
    let resolu: Progressifs | undefined;
    void routing.resolveMarketCandidatesProgressifs({ symbol: "BTCUSDT", timeframe: "1d" }).then((value) => { resolu = value; });
    await vi.advanceTimersByTimeAsync(299);
    expect(resolu).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(resolu?.immediats).toEqual([{ exchange: "binance", symbol: "BTCUSDT", timeframe: "1d" }]);
  });

  it("à froid, HYPEUSDT sans cache (catalogues à 300 ms, 500 ms par requête) : la sonde Binance ne retarde pas les autres, Bybit en tête à 1,3 s", async () => {
    const base = catalogues({ binance: 300, bybit: 300, okx: 300 });
    vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("mexc") ? Promise.reject(new Error("indisponible")) : base(url)));
    const lent = (bougies: (tf: Timeframe) => Candle[]) => (_symbol: string, tf: Timeframe) => new Promise<Candle[]>((ok) => setTimeout(() => ok(bougies(tf)), 500));
    const { routing } = await routage({}, {
      binance: lent((tf) => tf === "1w" ? serie(date("2026-09-21"), 1) : serie(date("2026-09-24"), 3, JOUR)),
      bybit: lent((tf) => tf === "1w" ? serie(date("2025-07-07"), 64) : serie(date("2025-07-11"), 443, JOUR)),
      okx: lent((tf) => tf === "1M" ? serie(date("2025-11-01"), 11, 30 * JOUR) : serie(date("2025-11-03"), 5)),
    });
    let resolu: Progressifs | undefined;
    void routing.resolveMarketCandidatesProgressifs({ exchange: "binance", symbol: "HYPEUSDT", timeframe: "1h" }).then((value) => { resolu = value; });
    // Catalogues à 300 ms, puis les trois sondes en parallèle : 1w (ou 1M) et affinage, 2 × 500 ms.
    await vi.advanceTimersByTimeAsync(1_299);
    expect(resolu).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(resolu?.immediats.map((c) => c.exchange)).toEqual(["bybit", "okx", "binance"]);
  });

  it("à froid, Binance déjà mesuré au plafond : son catalogue confirme, il part sans sonde ni attente des autres", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("api.binance.com") ? apres(200, { symbols: [{ symbol: "BTCUSDT", status: "TRADING" }] }) : new Promise(() => {})));
    const { routing, appels } = await routage(P_BTC);
    let resolu: Progressifs | undefined;
    void routing.resolveMarketCandidatesProgressifs({ symbol: "BTCUSDT", timeframe: "1m" }).then((value) => { resolu = value; });
    await vi.advanceTimersByTimeAsync(199);
    expect(resolu).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(resolu?.immediats).toEqual([{ exchange: "binance", symbol: "BTCUSDT", timeframe: "1m" }]);
    expect(appels()).toBe(0);
  });

  const sansBinance = (profondeurs: Profondeurs) => Object.fromEntries(Object.entries(profondeurs).filter(([cle]) => !cle.startsWith("binance:"))) as Profondeurs;
  it("à froid, Binance sans mesure et sonde Binance muette : bornée à 2,5 s, Binance garde le bénéfice du doute", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("api.binance.com") ? apres(0, { symbols: [{ symbol: "HYPEUSDT", status: "TRADING" }] }) : new Promise(() => {})));
    const { routing } = await routage(sansBinance(P_HYPE), { binance: () => new Promise(() => {}) });
    let resolu: Progressifs | undefined;
    void routing.resolveMarketCandidatesProgressifs({ symbol: "HYPEUSDT", timeframe: "1d" }).then((value) => { resolu = value; });
    await vi.advanceTimersByTimeAsync(2_499);
    expect(resolu).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(resolu?.immediats).toEqual([{ exchange: "binance", symbol: "HYPEUSDT", timeframe: "1d" }]);
  });

  it("à froid, catalogues en panne : le cache ne prouve aucune cotation, rien d'immédiat ; la liste complète classe les essais par profondeur connue", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("indisponible"))));
    const { routing, appels } = await routage(sansBinance(P_BTC));
    let resolu: Progressifs | undefined;
    void routing.resolveMarketCandidatesProgressifs({ symbol: "BTCUSDT", timeframe: "1d" }).then((value) => { resolu = value; });
    await vi.advanceTimersByTimeAsync(0);
    expect(resolu?.immediats).toEqual([]);
    // Binance, Coinbase et MEXC inconnus gardent le doute ; OKX et Kraken, plafonnés, sont prouvés moins profonds que Bybit.
    expect((await resolu!.complets()).map((c) => `${c.exchange}${c.speculative ? "?" : ""}`))
      .toEqual(["binance?", "coinbase?", "bybit?", "mexc?", "okx?", "kraken?"]);
    expect(appels()).toBe(0);
  });

  it("à froid sans cache : Binance attendu, les autres catalogues jusqu'à 2,5 s, classement par profondeur ; MEXC tardif dans la liste complète seulement", async () => {
    vi.stubGlobal("fetch", catalogues({ bybit: 1_000, okx: 2_000, mexc: 4_000 }));
    const { routing, espions } = await routage({}, SONDES_HYPE);
    let resolu: Awaited<ReturnType<typeof routing.resolveMarketCandidatesProgressifs>> | undefined;
    void routing.resolveMarketCandidatesProgressifs({ symbol: "HYPEUSDT", timeframe: "1h" }).then((value) => { resolu = value; });
    await vi.advanceTimersByTimeAsync(2_499);
    expect(resolu).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(resolu?.immediats.map((c) => c.exchange)).toEqual(["bybit", "okx", "binance"]);
    expect(espions.mexc).not.toHaveBeenCalled();
    let complets: string[] | undefined;
    void resolu!.complets().then((liste) => { complets = liste.map((c) => `${c.exchange}${c.speculative ? "?" : ""}`); });
    await vi.advanceTimersByTimeAsync(1_500);
    // MEXC mesuré à son tour (aucune bougie) ; Kraken et Coinbase, catalogues en panne, en essais :
    // en 1h, Kraken inconnu (500 heures au plus) est prouvé moins profond que Bybit, Coinbase non.
    expect(complets).toEqual(["bybit", "okx", "binance", "mexc", "coinbase?", "kraken?"]);
    expect(espions.mexc).toHaveBeenCalledTimes(1);
  });

  it("à froid, Binance lent : l'échéance recule jusqu'à son arrivée", async () => {
    vi.stubGlobal("fetch", catalogues({ binance: 4_000, bybit: 1_000, okx: 3_000, mexc: 5_000 }));
    const { routing } = await routage({}, SONDES_HYPE);
    let resolu: Awaited<ReturnType<typeof routing.resolveMarketCandidatesProgressifs>> | undefined;
    void routing.resolveMarketCandidatesProgressifs({ symbol: "HYPEUSDT", timeframe: "1d" }).then((value) => { resolu = value; });
    await vi.advanceTimersByTimeAsync(3_999);
    expect(resolu).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(resolu?.immediats.map((c) => c.exchange)).toEqual(["bybit", "okx", "binance"]);
  });

  it("catalogue en cache : mesure bornée avant de livrer la liste", async () => {
    vi.stubGlobal("fetch", catalogues({}));
    const lent = (bougies: Candle[]) => () => new Promise<Candle[]>((resolve) => setTimeout(() => resolve(bougies), 1_000));
    const { routing } = await routage({}, { binance: lent(serie(date("2026-09-24"), 1)), bybit: lent(serie(date("2025-07-11"), 64)), okx: lent(serie(date("2025-11-04"), 47)), mexc: lent(serie(date("2025-08-01"), 60)) });
    const catalogue = routing.fetchMarketCatalog();
    await vi.advanceTimersByTimeAsync(0);
    await catalogue;
    let resolu: Awaited<ReturnType<typeof routing.resolveMarketCandidatesProgressifs>> | undefined;
    void routing.resolveMarketCandidatesProgressifs({ exchange: "binance", symbol: "HYPEUSDT", timeframe: "1d" }).then((value) => { resolu = value; });
    // Sonde 1w (1 s) puis, cotations récentes, affinage 1d (1 s) : sous la borne de 2,5 s.
    await vi.advanceTimersByTimeAsync(1_999);
    expect(resolu).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(resolu?.immediats.map((c) => `${c.exchange}${c.speculative ? "?" : ""}`)).toEqual(["bybit", "mexc", "okx", "binance", "kraken?", "coinbase?"]);
  });

  it("catalogue périmé : un rafraîchissement fini pendant la mesure alimente la liste complète (MEXC coté depuis)", async () => {
    let nouveau = false;
    const base = catalogues({});
    const mexc = (symbol: string) => ({ symbols: [{ symbol, status: "1", isSpotTradingAllowed: true }] });
    vi.stubGlobal("fetch", vi.fn((url: string) => !url.includes("mexc") ? base(url) : nouveau ? apres(500, mexc("HYPEUSDT")) : apres(0, mexc("BTCUSDT"))));
    const lent = (bougies: Candle[]) => () => new Promise<Candle[]>((resolve) => setTimeout(() => resolve(bougies), 1_000));
    const { routing } = await routage({}, { binance: lent(serie(date("2026-09-24"), 1)), bybit: lent(serie(date("2025-07-11"), 64)), okx: lent(serie(date("2025-11-04"), 47)), mexc: lent(serie(date("2025-08-01"), 60)) });
    const initial = routing.fetchMarketCatalog();
    await vi.advanceTimersByTimeAsync(0);
    await initial;
    nouveau = true;
    await vi.advanceTimersByTimeAsync(300_000);
    let resolu: Awaited<ReturnType<typeof routing.resolveMarketCandidatesProgressifs>> | undefined;
    void routing.resolveMarketCandidatesProgressifs({ symbol: "HYPEUSDT", timeframe: "1d" }).then((value) => { resolu = value; });
    // La copie périmée est mesurée (1w puis 1d : 2 s) ; le rafraîchissement, lui, finit à 0,5 s.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(resolu?.immediats.map((c) => c.exchange).slice(0, 3)).toEqual(["bybit", "okx", "binance"]);
    let complets: string[] | undefined;
    void resolu!.complets().then((liste) => { complets = liste.map((c) => c.exchange); });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(complets?.slice(0, 4)).toEqual(["bybit", "mexc", "okx", "binance"]);
  });
});

describe("recherche : représentant par profondeur d'historique", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(MAINTENANT);
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("réseau interdit en test"))));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("HYPEUSDT est représenté par Bybit, places classées, sans aucune sonde", async () => {
    const { routing, appels } = await routage(P_HYPE);
    const mesure = vi.spyOn(await import("./profondeurHistorique"), "mesurerProfondeurs");
    expect(routing.searchMarkets(HYPE, "HYPE")).toEqual([{ exchange: "bybit", symbol: "HYPEUSDT", kind: "spot", places: ["bybit", "okx", "binance"] }]);
    expect(mesure).not.toHaveBeenCalled();
    expect(appels()).toBe(0);
  });

  it("le représentant suit l'unité de temps : HYPEUSD limité à Kraken et Coinbase, Kraken en 1d, Coinbase en 1h (défaut)", async () => {
    const { routing } = await routage(P_HYPEUSD);
    expect(routing.searchMarkets(HYPEUSD, "HYPEUSD", 30, "1d")[0]).toMatchObject({ exchange: "kraken", places: ["kraken", "coinbase"] });
    expect(routing.searchMarkets(HYPEUSD, "HYPEUSD")[0]).toMatchObject({ exchange: "coinbase", places: ["coinbase", "kraken"] });
  });

  it("profondeur incomplète signalée tant qu'une place du groupe n'est pas mesurée ; place unique sans champ ajouté", async () => {
    const { routing } = await routage({ "bybit:HYPEUSDT": [date("2025-07-11"), 1] });
    const catalogue: MarketCatalog = { ...HYPE, instruments: [...HYPE.instruments, { exchange: "okx", symbol: "CARDSUSDT", kind: "spot" }] };
    expect(routing.searchMarkets(catalogue, "USDT")).toEqual([
      { exchange: "binance", symbol: "HYPEUSDT", kind: "spot", places: ["binance", "bybit", "okx"], profondeurIncomplete: true },
      { exchange: "okx", symbol: "CARDSUSDT", kind: "spot" },
    ]);
  });

  it("l'ordre des résultats ne dépend pas des mesures : seul le représentant change", async () => {
    const { routing } = await routage(P_BTCUSD);
    const catalogue: MarketCatalog = { unavailableSources: [], instruments: [
      { exchange: "binance", symbol: "BTCUSDT", kind: "spot" }, { exchange: "kraken", symbol: "BTCUSD", kind: "spot" },
      { exchange: "coinbase", symbol: "BTCUSD", kind: "spot" }, { exchange: "hyperliquid", symbol: "BTC-PERP", kind: "perp" },
    ] };
    expect(routing.searchMarkets(catalogue, "BTC").map((x) => [x.symbol, x.exchange])).toEqual([
      ["BTCUSDT", "binance"], ["BTCUSD", "coinbase"], ["BTC-PERP", "hyperliquid"],
    ]);
  });
});
