/**
 * Règles PURES de lisibilité de la watchlist (env vitest node, pas de jsdom).
 * Le rendu (troncature réelle à 1440×240) est vérifié par e2e/corrections-revue.e2e.ts.
 * La résolution des provenances vit hors React : testée ici à timers simulés, avec le vrai
 * routage des sondes et un réseau bouchonné (aucun appel réel).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExchangeId } from "@axiom/types";
import { colonnesWatchlistPourLargeur, suivreProvenancesFavoris } from "./Watchlist";
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

/** Réseau bouchonné : prix Binance 24 h et OKX par instrument ; `okxSansPrix` simule un prix absent. */
function reseau(okxSansPrix = new Set<string>()) {
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = String(input);
    urls.push(url);
    const params = new URL(url, "http://local").searchParams;
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

  it("[TOTAL, BTCUSDT(binance)] : une seule sonde, puis plus aucune pendant 90 s", async () => {
    watchlistStore.getState().setAll(["TOTAL", "TOTAL2", "binance:ETHUSDT|/|binance:BTCUSDT", "BTCUSDT"], { BTCUSDT: "binance", TOTAL2: "synthetic" });
    catalogue(spot(["binance", "BTCUSDT"]));
    const urls = reseau();
    const sonde = vi.spyOn(ticker, "resolveTickerMarket");
    stop = suivreProvenancesFavoris();
    await vi.advanceTimersByTimeAsync(0);
    expect(sonde).toHaveBeenCalledTimes(1);
    expect(urls).toEqual(["https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT"]);
    await vi.advanceTimersByTimeAsync(90_000);
    // Les synthétiques restent sans prix de favoris : ni sondés, ni réessayés.
    expect(sonde).toHaveBeenCalledTimes(1);
    expect(urls).toHaveLength(1);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "binance", TOTAL2: "synthetic" });
  });

  it("une republication du catalogue ne resonde pas un favori confirmé", async () => {
    watchlistStore.getState().setAll(["BTCUSDT", "CARDSUSDT"], { BTCUSDT: "binance", CARDSUSDT: "okx" });
    const initial = spot(["binance", "BTCUSDT"], ["okx", "CARDSUSDT"]);
    const { publier } = catalogue(initial);
    const urls = reseau();
    stop = suivreProvenancesFavoris();
    await vi.advanceTimersByTimeAsync(0);
    expect(urls).toHaveLength(2);
    publier({ ...initial, instruments: [...initial.instruments] });
    publier({ ...initial, instruments: [...initial.instruments] });
    await vi.advanceTimersByTimeAsync(0);
    expect(urls).toHaveLength(2);
  });

  it("un favori sans prix est resondé seul, à la republication et toutes les 30 s, jusqu'à son prix", async () => {
    watchlistStore.getState().setAll(["BTCUSDT", "CARDSUSDT"], { BTCUSDT: "binance", CARDSUSDT: "okx" });
    const initial = spot(["binance", "BTCUSDT"], ["okx", "CARDSUSDT"]);
    const { publier } = catalogue(initial);
    const sansPrix = new Set(["CARDS-USDT"]);
    const urls = reseau(sansPrix);
    stop = suivreProvenancesFavoris();
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
    expect(urls.filter((url) => url.includes("symbol=BTCUSDT"))).toHaveLength(1);
    expect(urls.some((url) => url.includes("tickers?instType"))).toBe(false);
  });

  it("okx:BTCUSDT revient à Binance quand son catalogue le liste ; CARDSUSDT, propre à OKX, reste sur OKX", async () => {
    watchlistStore.getState().setAll(["BTCUSDT", "CARDSUSDT"], { BTCUSDT: "okx", CARDSUSDT: "okx" });
    catalogue(spot(["binance", "BTCUSDT"], ["okx", "BTCUSDT"], ["okx", "CARDSUSDT"]));
    const urls = reseau();
    stop = suivreProvenancesFavoris();
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
    stop = suivreProvenancesFavoris();
    await vi.advanceTimersByTimeAsync(0);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "okx" });
    expect(urls.some((url) => url.includes("kraken"))).toBe(false);
  });

  it("sans Binance au catalogue, okx:BTCUSDT garde sa place", async () => {
    watchlistStore.getState().setAll(["BTCUSDT"], { BTCUSDT: "okx" });
    catalogue(spot(["okx", "BTCUSDT"]));
    reseau();
    stop = suivreProvenancesFavoris();
    await vi.advanceTimersByTimeAsync(0);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "okx" });
  });

  it("le graphe prêt sur un repli garde sa provenance, sans sonde", async () => {
    watchlistStore.getState().setAll(["BTCUSDT"]);
    graphePret("bybit", "BTCUSDT");
    catalogue(spot(["binance", "BTCUSDT"], ["bybit", "BTCUSDT"]));
    const urls = reseau();
    stop = suivreProvenancesFavoris();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "bybit" });
    expect(urls).toEqual([]);
  });

  it("un favori ajouté est sondé seul ; l'arrêt annule la sonde en vol", async () => {
    watchlistStore.getState().setAll(["BTCUSDT"], { BTCUSDT: "binance" });
    catalogue(spot(["binance", "BTCUSDT"], ["binance", "ETHUSDT"], ["binance", "SOLUSDT"]));
    const urls = reseau();
    stop = suivreProvenancesFavoris();
    await vi.advanceTimersByTimeAsync(0);
    watchlistStore.getState().add("ETHUSDT");
    await vi.advanceTimersByTimeAsync(0);
    expect(urls).toEqual([
      "https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT",
      "https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT",
    ]);
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
