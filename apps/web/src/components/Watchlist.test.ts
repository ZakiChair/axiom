/**
 * Règles PURES de lisibilité de la watchlist (env vitest node, pas de jsdom).
 * Le rendu (troncature réelle à 1440×240) est vérifié par e2e/corrections-revue.e2e.ts.
 * La résolution des provenances vit hors React : testée ici à timers simulés, avec le vrai
 * routage des sondes et un réseau bouchonné (aucun appel réel).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExchangeId } from "@axiom/types";
import { colonnesWatchlistPourLargeur, nouvelleSessionProvenances, suivreProvenancesFavoris } from "./Watchlist";
import * as routing from "../data/marketRouting";
import * as ticker from "../data/ticker";
import { marketStore } from "../store/market";
import { watchlistStore } from "../store/watchlist";

describe("lisibilité watchlist", () => {
  it("à 240 px (sidebar w-60) masque la sparkline et garde le Δ% 24h", () => {
    const cols = colonnesWatchlistPourLargeur(240);
    expect(cols.change24h).toBe(true);
    expect(cols.spark).toBe(false);
  });

  it("à largeur confortable garde sparkline et Δ% 24h", () => {
    const cols = colonnesWatchlistPourLargeur(360);
    expect(cols.change24h).toBe(true);
    expect(cols.spark).toBe(true);
  });
});

const reponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const spot = (...entrees: Array<[ExchangeId, string]>): routing.MarketCatalog => ({
  instruments: entrees.map(([exchange, symbol]) => ({ exchange, symbol, kind: "spot" as const })),
  unavailableSources: [],
});

/** Twelve Data sans l'abonnement requis (WTI/USD en clé gratuite) : aucun prix, jamais. */
const abonnementRequis = () => ({ code: 403, status: "error", message: "/quote is available exclusively with grow or pro plans" });

/**
 * Réseau bouchonné : prix Binance 24 h, OKX par instrument et /quote Twelve Data ;
 * `okxSansPrix` simule un prix OKX absent.
 */
function reseau(okxSansPrix = new Set<string>(), quoteTd: (url: string) => unknown = abonnementRequis) {
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = String(input);
    urls.push(url);
    const params = new URL(url, "http://local").searchParams;
    if (url.startsWith("/tdapi/quote?")) return reponse(quoteTd(url));
    if (url.startsWith("https://api.binance.com/api/v3/ticker/24hr")) {
      return reponse({ symbol: params.get("symbol"), lastPrice: "100", priceChangePercent: "1" });
    }
    if (url.startsWith("https://www.okx.com/api/v5/market/ticker?")) {
      const instId = params.get("instId") ?? "";
      return reponse({ code: "0", data: okxSansPrix.has(instId) ? [] : [{ instType: "SPOT", instId, last: "0.12", open24h: "0.1" }] });
    }
    return new Response("{}", { status: 503 });
  }));
  return urls;
}

/** Catalogue servi sans réseau ; `publier` simule une republication (autre surface, réessai). */
function catalogue(initial: routing.MarketCatalog) {
  let listener: ((catalog: routing.MarketCatalog) => void) | undefined;
  vi.spyOn(routing, "fetchMarketCatalog").mockResolvedValue(initial);
  vi.spyOn(routing, "subscribeMarketCatalog").mockImplementation((next) => {
    listener = next;
    return () => { listener = undefined; };
  });
  return { publier: (catalog: routing.MarketCatalog) => listener?.(catalog) };
}

/** Graphe prêt sur `exchange:symbol` (vrai cycle du store, sans backfill réseau). */
function graphePret(exchange: ExchangeId, symbol: string) {
  const identity = { exchange, symbol, timeframe: "1h" as const };
  marketStore.getState().setMarket(identity);
  const requestId = marketStore.getState().startDataLoad(identity);
  if (requestId === null) throw new Error("backfill refusé");
  marketStore.getState().completeDataLoad(identity, requestId, [{ time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 }]);
}

describe("provenances des favoris", () => {
  let stop: () => void = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    // Actif affiché hors watchlist et pas encore prêt : aucun raccourci « graphe prêt ».
    marketStore.getState().setMarket({ exchange: "binance", symbol: "XRPUSDT", timeframe: "1h" });
  });
  afterEach(() => {
    stop();
    stop = () => {};
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    watchlistStore.getState().setAll([]);
  });

  it("[TOTAL, BTCUSDT(binance)] : seul le favori sans source est sondé, puis plus rien pendant 90 s", async () => {
    watchlistStore.getState().setAll(["TOTAL", "TOTAL2", "binance:ETHUSDT|/|binance:BTCUSDT", "BTCUSDT", "ETHUSDT"], { BTCUSDT: "binance", TOTAL2: "synthetic" });
    catalogue(spot(["binance", "BTCUSDT"], ["binance", "ETHUSDT"]));
    const urls = reseau();
    const sonde = vi.spyOn(ticker, "resolveTickerMarket");
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    expect(sonde).toHaveBeenCalledTimes(1);
    expect(urls).toEqual(["https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT"]);
    await vi.advanceTimersByTimeAsync(90_000);
    // Les synthétiques restent sans prix de favoris : ni sondés, ni réessayés.
    expect(sonde).toHaveBeenCalledTimes(1);
    expect(urls).toHaveLength(1);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "binance", ETHUSDT: "binance", TOTAL2: "synthetic" });
  });

  it("une republication du catalogue ne resonde pas un favori confirmé", async () => {
    watchlistStore.getState().setAll(["BTCUSDT", "CARDSUSDT"], { BTCUSDT: "binance", CARDSUSDT: "okx" });
    const initial = spot(["binance", "BTCUSDT"], ["okx", "CARDSUSDT"]);
    const { publier } = catalogue(initial);
    const urls = reseau();
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    expect(urls).toEqual(["https://www.okx.com/api/v5/market/ticker?instId=CARDS-USDT"]);
    publier({ ...initial, instruments: [...initial.instruments] });
    publier({ ...initial, instruments: [...initial.instruments] });
    await vi.advanceTimersByTimeAsync(0);
    expect(urls).toHaveLength(1);
  });

  it("un favori sans prix est resondé seul, à la republication et toutes les 30 s, jusqu'à son prix", async () => {
    watchlistStore.getState().setAll(["BTCUSDT", "CARDSUSDT"], { BTCUSDT: "binance", CARDSUSDT: "okx" });
    const initial = spot(["binance", "BTCUSDT"], ["okx", "CARDSUSDT"]);
    const { publier } = catalogue(initial);
    const sansPrix = new Set(["CARDS-USDT"]);
    const urls = reseau(sansPrix);
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    const cards = () => urls.filter((url) => url.includes("instId=CARDS-USDT")).length;
    expect(cards()).toBe(1);
    publier({ ...initial });
    await vi.advanceTimersByTimeAsync(0);
    expect(cards()).toBe(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(cards()).toBe(3);
    sansPrix.clear();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(cards()).toBe(4);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(cards()).toBe(4);
    expect(urls.every((url) => url === "https://www.okx.com/api/v5/market/ticker?instId=CARDS-USDT")).toBe(true);
  });

  it("okx:BTCUSDT revient à Binance quand son catalogue le liste ; CARDSUSDT, propre à OKX, reste sur OKX", async () => {
    watchlistStore.getState().setAll(["BTCUSDT", "CARDSUSDT"], { BTCUSDT: "okx", CARDSUSDT: "okx" });
    catalogue(spot(["binance", "BTCUSDT"], ["okx", "BTCUSDT"], ["okx", "CARDSUSDT"]));
    const urls = reseau();
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "binance", CARDSUSDT: "okx" });
    expect(urls.sort()).toEqual([
      "https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT",
      "https://www.okx.com/api/v5/market/ticker?instId=CARDS-USDT",
    ]);
  });

  it("sans prix Binance, okx:BTCUSDT garde sa place d'origine, jamais une troisième", async () => {
    watchlistStore.getState().setAll(["BTCUSDT"], { BTCUSDT: "okx" });
    catalogue(spot(["binance", "BTCUSDT"], ["kraken", "BTCUSDT"], ["okx", "BTCUSDT"]));
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      urls.push(String(input));
      if (String(input).startsWith("https://api.kraken.com/")) return reponse({ error: [], result: { XBTUSDT: { c: ["60000"], o: "59000" } } });
      if (String(input).startsWith("https://www.okx.com/")) return reponse({ code: "0", data: [{ instType: "SPOT", instId: "BTC-USDT", last: "60000" }] });
      return new Response("{}", { status: 503 });
    }));
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "okx" });
    expect(urls.some((url) => url.includes("kraken"))).toBe(false);
  });

  it("favori Binance que Binance liste : jamais sondé, un ticker Binance en panne ne le déplace pas", async () => {
    watchlistStore.getState().setAll(["ETHUSDT"], { ETHUSDT: "binance" });
    catalogue(spot(["binance", "ETHUSDT"], ["kraken", "ETHUSDT"], ["okx", "ETHUSDT"]));
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      urls.push(String(input));
      if (String(input).startsWith("https://www.okx.com/")) return reponse({ code: "0", data: [{ instType: "SPOT", instId: "ETH-USDT", last: "3000" }] });
      return new Response("{}", { status: 503 });
    }));
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(90_000);
    expect(watchlistStore.getState().sources).toEqual({ ETHUSDT: "binance" });
    expect(urls).toEqual([]);
  });

  it("catalogue Binance indisponible : un favori Binance n'est sondé que sur Binance, sa source ne change jamais", async () => {
    watchlistStore.getState().setAll(["BTCUSDT"], { BTCUSDT: "binance" });
    const { publier } = catalogue({ ...spot(["kraken", "BTCUSDT"], ["okx", "BTCUSDT"]), unavailableSources: ["binance"] });
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      urls.push(String(input));
      if (String(input).startsWith("https://api.kraken.com/")) return reponse({ error: [], result: { XBTUSDT: { c: ["60000"], o: "59000" } } });
      if (String(input).startsWith("https://www.okx.com/")) return reponse({ code: "0", data: [{ instType: "SPOT", instId: "BTC-USDT", last: "60000" }] });
      return new Response("{}", { status: 503 });
    }));
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "binance" });
    expect(urls).toEqual(["https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT"]);
    // Sans prix Binance : non confirmé, réessayé à 30 s, toujours sur Binance seul.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(urls).toEqual(Array(2).fill("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT"));
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "binance" });
    // Le catalogue Binance revenu le liste : confirmé sans sonde.
    publier(spot(["binance", "BTCUSDT"], ["kraken", "BTCUSDT"], ["okx", "BTCUSDT"]));
    await vi.advanceTimersByTimeAsync(90_000);
    expect(urls).toHaveLength(2);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "binance" });
  });

  it("échec OKX passager : CARDSUSDT(okx) n'est jamais sondé sur une troisième place et reste sur OKX", async () => {
    watchlistStore.getState().setAll(["CARDSUSDT"], { CARDSUSDT: "okx" });
    catalogue(spot(["kraken", "CARDSUSDT"], ["okx", "CARDSUSDT"]));
    let okxPrix = false;
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      urls.push(String(input));
      if (String(input).startsWith("https://api.kraken.com/")) return reponse({ error: [], result: { CARDSUSDT: { c: ["0.12"], o: "0.1" } } });
      if (String(input).startsWith("https://www.okx.com/")) return reponse({ code: "0", data: okxPrix ? [{ instType: "SPOT", instId: "CARDS-USDT", last: "0.12" }] : [] });
      return new Response("{}", { status: 503 });
    }));
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    expect(watchlistStore.getState().sources).toEqual({ CARDSUSDT: "okx" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(urls).toEqual(Array(2).fill("https://www.okx.com/api/v5/market/ticker?instId=CARDS-USDT"));
    okxPrix = true;
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(urls).toEqual(Array(3).fill("https://www.okx.com/api/v5/market/ticker?instId=CARDS-USDT"));
    expect(watchlistStore.getState().sources).toEqual({ CARDSUSDT: "okx" });
  });

  it("provenance Binance démentie par son catalogue (CARDSUSDT absent) : réparée vers la place qui le liste", async () => {
    watchlistStore.getState().setAll(["CARDSUSDT"], { CARDSUSDT: "binance" });
    catalogue(spot(["binance", "BTCUSDT"], ["okx", "CARDSUSDT"]));
    const urls = reseau();
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    expect(watchlistStore.getState().sources).toEqual({ CARDSUSDT: "okx" });
    expect(urls).toEqual(["https://www.okx.com/api/v5/market/ticker?instId=CARDS-USDT"]);
  });

  it("une source confirmée, changée hors de la watchlist sans changer la liste, est resondée", async () => {
    watchlistStore.getState().setAll(["BTCUSDT"], { BTCUSDT: "binance" });
    catalogue(spot(["binance", "BTCUSDT"], ["okx", "BTCUSDT"]));
    const urls = reseau();
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    expect(urls).toEqual([]);
    // Ce que fait hydrateWatchlist() à la réconciliation daemon : un setState direct.
    watchlistStore.setState({ sources: { BTCUSDT: "okx" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "binance" });
    expect(urls).toEqual(["https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT"]);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(urls).toHaveLength(1);
  });

  it("une confirmation interne (graphe prêt sur un repli) ne relance pas les sondes en vol", async () => {
    watchlistStore.getState().setAll(["BTCUSDT", "ETHUSDT"], { BTCUSDT: "binance" });
    catalogue(spot(["binance", "BTCUSDT"], ["bybit", "BTCUSDT"], ["binance", "ETHUSDT"]));
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    graphePret("bybit", "BTCUSDT");
    await vi.advanceTimersByTimeAsync(0);
    const [url, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT");
    expect(init.signal?.aborted).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "bybit" });
  });

  it("sans Binance au catalogue, okx:BTCUSDT garde sa place", async () => {
    watchlistStore.getState().setAll(["BTCUSDT"], { BTCUSDT: "okx" });
    catalogue(spot(["okx", "BTCUSDT"]));
    reseau();
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "okx" });
  });

  it("le graphe prêt sur un repli garde sa provenance, sans sonde", async () => {
    watchlistStore.getState().setAll(["BTCUSDT"]);
    graphePret("bybit", "BTCUSDT");
    catalogue(spot(["binance", "BTCUSDT"], ["bybit", "BTCUSDT"]));
    const urls = reseau();
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(90_000);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "bybit" });
    expect(urls).toEqual([]);
  });

  it("un remontage (sortie du plein écran) ne resonde aucun favori confirmé de la session", async () => {
    watchlistStore.getState().setAll(["LINKUSDT", "CARDSUSDT"], { CARDSUSDT: "okx" });
    catalogue(spot(["binance", "LINKUSDT"], ["okx", "CARDSUSDT"]));
    const urls = reseau();
    // Session par défaut, au niveau du module : celle que le composant garde d'un montage à l'autre.
    stop = suivreProvenancesFavoris();
    await vi.advanceTimersByTimeAsync(0);
    expect(urls.sort()).toEqual([
      "https://api.binance.com/api/v3/ticker/24hr?symbol=LINKUSDT",
      "https://www.okx.com/api/v5/market/ticker?instId=CARDS-USDT",
    ]);
    stop();
    stop = suivreProvenancesFavoris();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(urls).toHaveLength(2);
    expect(watchlistStore.getState().sources).toEqual({ LINKUSDT: "binance", CARDSUSDT: "okx" });
  });

  it("Twelve Data sans source : sondé au montage et aux changements de liste, jamais au réessai ni au catalogue", async () => {
    vi.setSystemTime(new Date("2026-09-23T14:00:00Z")); // mercredi : forex ouvert
    watchlistStore.getState().setAll(["WTI/USD", "CARDSUSDT"], { CARDSUSDT: "okx" });
    const initial = spot(["okx", "CARDSUSDT"], ["binance", "ETHUSDT"]);
    const { publier } = catalogue(initial);
    // CARDS reste sans prix : le réessai crypto à 30 s tourne pendant tout le test.
    const urls = reseau(new Set(["CARDS-USDT"]));
    const quotes = () => urls.filter((url) => url.startsWith("/tdapi/quote?"));
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    expect(quotes()).toEqual(["/tdapi/quote?symbol=WTI%2FUSD"]);
    for (let i = 0; i < 3; i++) publier({ ...initial, instruments: [...initial.instruments] });
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(quotes()).toHaveLength(1);
    expect(urls.filter((url) => url.includes("instId=CARDS-USDT")).length).toBeGreaterThan(100);
    watchlistStore.getState().add("ETHUSDT");
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(quotes()).toHaveLength(2);
    expect(watchlistStore.getState().sources).toEqual({ CARDSUSDT: "okx", ETHUSDT: "binance" });
  });

  it("une sonde Twelve Data en vol n'est pas doublée par un changement de liste", async () => {
    vi.setSystemTime(new Date("2026-09-23T14:00:00Z"));
    watchlistStore.getState().setAll(["WTI/USD"]);
    catalogue(spot(["binance", "ETHUSDT"]));
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn((input: string) => {
      urls.push(String(input));
      // Réponse Twelve Data qui ne revient pas : la sonde reste en vol.
      if (String(input).startsWith("/tdapi/")) return new Promise<Response>(() => {});
      return Promise.resolve(reponse({ symbol: "ETHUSDT", lastPrice: "3000", priceChangePercent: "1" }));
    }));
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    watchlistStore.getState().add("ETHUSDT");
    await vi.advanceTimersByTimeAsync(0);
    expect(urls.sort()).toEqual(["/tdapi/quote?symbol=WTI%2FUSD", "https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT"]);
  });

  it("un actif TradFi sans prix n'est pas resondé au remontage, mais l'est au changement de liste", async () => {
    vi.setSystemTime(new Date("2026-09-23T14:00:00Z"));
    watchlistStore.getState().setAll(["WTI/USD"]);
    catalogue(spot(["binance", "ETHUSDT"]));
    const urls = reseau();
    const quotes = () => urls.filter((url) => url.startsWith("/tdapi/quote?"));
    const session = nouvelleSessionProvenances();
    stop = suivreProvenancesFavoris(session);
    await vi.advanceTimersByTimeAsync(0);
    expect(quotes()).toHaveLength(1);
    stop();
    stop = suivreProvenancesFavoris(session);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(quotes()).toHaveLength(1);
    watchlistStore.getState().add("ETHUSDT");
    await vi.advanceTimersByTimeAsync(0);
    expect(quotes()).toHaveLength(2);
  });

  it("marché fermé (samedi) : aucune requête Twelve Data, ni au montage ni ensuite", async () => {
    vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
    watchlistStore.getState().setAll(["WTI/USD", "AAPL", "EUR/USD"]);
    catalogue(spot());
    const urls = reseau(new Set(), () => ({ close: "100", percent_change: "1" }));
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(urls).toEqual([]);
    expect(watchlistStore.getState().sources).toEqual({});
  });

  it("un actif TradFi ajouté marché fermé est sondé une seule fois, à l'ouverture de son marché", async () => {
    vi.setSystemTime(new Date("2026-09-26T12:00:00Z")); // samedi
    watchlistStore.getState().setAll(["AAPL", "WTI/USD"]);
    catalogue(spot());
    const urls = reseau(new Set(), (url) => url.includes("AAPL") ? { close: "230", percent_change: "1" } : abonnementRequis());
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    expect(urls).toEqual([]);
    // Dimanche 23:00Z : le forex a rouvert (22:00Z), la bourse US reste fermée.
    await vi.advanceTimersByTimeAsync(Date.parse("2026-09-27T23:00:00Z") - Date.now());
    expect(urls).toEqual(["/tdapi/quote?symbol=WTI%2FUSD"]);
    // Lundi 14:00Z : séance US ouverte depuis 13:20Z.
    await vi.advanceTimersByTimeAsync(Date.parse("2026-09-28T14:00:00Z") - Date.now());
    expect(urls).toEqual(["/tdapi/quote?symbol=WTI%2FUSD", "/tdapi/quote?symbol=AAPL"]);
    expect(watchlistStore.getState().sources).toEqual({ AAPL: "twelvedata" });
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    expect(urls).toHaveLength(2);
  });

  it("une source Twelve Data enregistrée n'est jamais sondée, remontage compris : les quotes la servent", async () => {
    vi.setSystemTime(new Date("2026-09-23T14:00:00Z")); // mercredi, séance US ouverte
    watchlistStore.getState().setAll(["SPY", "AAPL"], { SPY: "twelvedata", AAPL: "twelvedata" });
    catalogue(spot());
    const urls = reseau();
    const session = nouvelleSessionProvenances();
    stop = suivreProvenancesFavoris(session);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    stop = suivreProvenancesFavoris(session);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(urls).toEqual([]);
    expect(watchlistStore.getState().sources).toEqual({ SPY: "twelvedata", AAPL: "twelvedata" });
  });

  it("une confirmation démentie pendant le démontage est oubliée au remontage, sans sonde doublée", async () => {
    // ETHUSDT, confirmé plus tôt dans la session, a été retiré puis rajouté : il n'a plus de source.
    const session = nouvelleSessionProvenances();
    session.confirmees.set("ETHUSDT", "binance");
    watchlistStore.getState().setAll(["BTCUSDT", "ETHUSDT"]);
    catalogue(spot(["binance", "BTCUSDT"], ["binance", "ETHUSDT"]));
    const urls = reseau();
    stop = suivreProvenancesFavoris(session);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(urls.sort()).toEqual([
      "https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT",
      "https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT",
    ]);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "binance", ETHUSDT: "binance" });
  });

  it("un favori ajouté est sondé seul ; l'arrêt annule la sonde en vol", async () => {
    watchlistStore.getState().setAll(["BTCUSDT"], { BTCUSDT: "binance" });
    catalogue(spot(["binance", "BTCUSDT"], ["binance", "ETHUSDT"], ["binance", "SOLUSDT"]));
    const urls = reseau();
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    watchlistStore.getState().add("ETHUSDT");
    await vi.advanceTimersByTimeAsync(0);
    expect(urls).toEqual(["https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT"]);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "binance", ETHUSDT: "binance" });
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    watchlistStore.getState().add("SOLUSDT");
    await vi.advanceTimersByTimeAsync(0);
    const enVol = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
    stop();
    expect(enVol[1].signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
