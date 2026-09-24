import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTickerMarket, subscribeTickers, subscribeWatchlistBars } from "./ticker";
import * as routing from "./marketRouting";
import { okxAdapter } from "./okx";
import { binanceAdapter } from "./binance";
import { watchlistStore } from "../store/watchlist";

const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const cards = { instType: "SPOT", instId: "CARDS-USDT", last: "0.18", open24h: "0.15", volCcy24h: "123.4", vol24h: "999" };
const originalResolver = routing.resolveMarketCandidates;

beforeEach(() => {
  vi.useFakeTimers();
  watchlistStore.getState().setAll([]);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  watchlistStore.getState().setAll([]);
});

describe("prix des sources existantes", () => {
  it("émet CARDSUSDT depuis OKX, groupe le lot et conserve le volume quote natif", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ code: "0", data: [cards, { ...cards, instId: "BTC-USDT", last: "60000" }] }));
    vi.stubGlobal("fetch", fetcher);
    const cb = vi.fn();
    const stop = subscribeTickers(["CARDSUSDT", "BTCUSDT"], cb, { source: "okx" });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("/api/v5/market/tickers?instType=SPOT");
    expect(cb).toHaveBeenCalledWith({ symbol: "CARDSUSDT", price: 0.18, changePercent: expect.closeTo(20), quoteVolume: 123.4 });
    const signal = fetcher.mock.calls[0]?.[1].signal as AbortSignal;
    stop();
    expect(signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("Bybit spot calcule 24 h depuis les prix natifs et utilise turnover24h", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ retCode: 0, result: { category: "spot", list: [
      { symbol: "BTCUSDT", lastPrice: "110", prevPrice24h: "100", price24hPcnt: "0.1", volume24h: "999", turnover24h: "12.5" },
    ] } })));
    const cb = vi.fn();
    const stop = subscribeTickers(["BTCUSDT"], cb, { source: "bybit" });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    expect(cb).toHaveBeenCalledWith({ symbol: "BTCUSDT", price: 110, changePercent: 10, quoteVolume: 12.5 });
  });

  it("Hyperliquid prend le dernier trade daté et la casse native kPEPE, jamais markPx", async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { type: string; coin?: string };
      if (body.type === "metaAndAssetCtxs") return response([
        { universe: [{ name: "kPEPE" }] }, [{ prevDayPx: "0.01", dayNtlVlm: "456", markPx: "99" }],
      ]);
      expect(body).toEqual({ type: "recentTrades", coin: "kPEPE" });
      return response([{ coin: "kPEPE", px: "0.011", time: 200 }, { coin: "kPEPE", px: "0.009", time: 100 }]);
    });
    vi.stubGlobal("fetch", fetcher);
    const cb = vi.fn();
    const stop = subscribeTickers(["KPEPE-PERP"], cb, { source: "hyperliquid" });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    expect(cb).toHaveBeenCalledWith({ symbol: "KPEPE-PERP", price: 0.011, changePercent: expect.closeTo(10), quoteVolume: 456 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(["", "0", "-1", "NaN", "Infinity"])("rejette un prix OKX invalide %s", async (last) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ code: "0", data: [{ ...cards, last }] })));
    const cb = vi.fn();
    const stop = subscribeTickers(["CARDSUSDT"], cb, { source: "okx" });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    expect(cb).not.toHaveBeenCalled();
  });

  it("ne remplace pas un volume absent par base × dernier prix, ni une variation absente par zéro", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ code: "0", data: [{ ...cards, volCcy24h: "", open24h: "" }] })));
    const cb = vi.fn();
    const stop = subscribeTickers(["CARDSUSDT"], cb, { source: "okx" });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    expect(cb.mock.calls[0]?.[0]).toEqual({ symbol: "CARDSUSDT", price: 0.18, changePercent: NaN, quoteVolume: undefined });
  });

  it("Coinbase passe par le proxy /extapi (api.coinbase.com n'expose aucun en-tête CORS)", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ products: [
      { product_id: "BTC-USD", price: "60000", price_percentage_change_24h: "2.5" },
      { product_id: "ETH-USDC", price: "3000", price_percentage_change_24h: "-1" },
    ] }));
    vi.stubGlobal("fetch", fetcher);
    const cb = vi.fn();
    const stop = subscribeTickers(["BTCUSD", "ETHUSDC"], cb, { source: "coinbase" });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const url = String(fetcher.mock.calls[0]?.[0]);
    expect(url.startsWith("/extapi/api.coinbase.com/api/v3/brokerage/market/products?")).toBe(true);
    expect(new URLSearchParams(url.split("?")[1]).getAll("product_ids")).toEqual(["BTC-USD", "ETH-USDC"]);
    expect(cb).toHaveBeenCalledWith({ symbol: "BTCUSD", price: 60000, changePercent: 2.5 });
    expect(cb).toHaveBeenCalledWith({ symbol: "ETHUSDC", price: 3000, changePercent: -1 });
  });

  it("ignore une réponse REST achevée après le désabonnement", async () => {
    let finish!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
    const cb = vi.fn();
    const stop = subscribeTickers(["CARDSUSDT"], cb, { source: "okx" });
    stop();
    finish(response({ code: "0", data: [cards] }));
    await vi.advanceTimersByTimeAsync(0);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("résolution vérifiée du ticker", () => {
  it("retrouve CARDSUSDT par son prix OKX quand les catalogues spot sont indisponibles", async () => {
    vi.spyOn(routing, "resolveMarketCandidates").mockImplementation((identity) => originalResolver(identity, {
      instruments: [], unavailableSources: ["binance", "okx"],
    }));
    const fetcher = vi.fn(async (url: string) => url.includes("okx.com")
      ? response({ code: "0", data: [cards] })
      : response({ code: -1121, msg: "Invalid symbol" }));
    vi.stubGlobal("fetch", fetcher);
    expect(await resolveTickerMarket({ symbol: "CARDSUSDT", timeframe: "1h" })).toEqual({ exchange: "okx", symbol: "CARDSUSDT", timeframe: "1h" });
  });

  it("la sonde OKX d'un symbole ne télécharge que son instrument, pas la liste SPOT entière", async () => {
    vi.spyOn(routing, "resolveMarketCandidates").mockResolvedValue([{ exchange: "okx", symbol: "CARDSUSDT", timeframe: "1h" }]);
    const fetcher = vi.fn(async () => response({ code: "0", data: [cards] }));
    vi.stubGlobal("fetch", fetcher);
    expect(await resolveTickerMarket({ symbol: "CARDSUSDT", timeframe: "1h" })).toEqual({ exchange: "okx", symbol: "CARDSUSDT", timeframe: "1h" });
    expect(fetcher.mock.calls.map((call) => String((call as unknown as [string])[0]))).toEqual(["https://www.okx.com/api/v5/market/ticker?instId=CARDS-USDT"]);
  });

  it("un instrument OKX inconnu (code 51001, HTTP 200) n'est pas confirmé", async () => {
    vi.spyOn(routing, "resolveMarketCandidates").mockResolvedValue([{ exchange: "okx", symbol: "NOPEUSDT", timeframe: "1h" }]);
    vi.stubGlobal("fetch", vi.fn(async () => response({ code: "51001", data: [], msg: "Instrument ID doesn't exist." })));
    expect(await resolveTickerMarket({ symbol: "NOPEUSDT", timeframe: "1h" })).toBeUndefined();
  });

  it("route les candidats sur le catalogue déjà publié par l'appelant", async () => {
    const catalog: routing.MarketCatalog = { instruments: [{ exchange: "okx", symbol: "CARDSUSDT", kind: "spot" }], unavailableSources: [] };
    const candidates = vi.spyOn(routing, "resolveMarketCandidates");
    vi.stubGlobal("fetch", vi.fn(async () => response({ code: "0", data: [cards] })));
    expect(await resolveTickerMarket({ symbol: "CARDSUSDT", timeframe: "1h" }, undefined, catalog)).toEqual({ exchange: "okx", symbol: "CARDSUSDT", timeframe: "1h" });
    expect(candidates).toHaveBeenCalledWith({ symbol: "CARDSUSDT", timeframe: "1h" }, catalog);
  });

  it("n'attribue aucune source lorsque tous les prix sont absents", async () => {
    vi.spyOn(routing, "resolveMarketCandidates").mockResolvedValue([{ exchange: "binance", symbol: "CARDSUSDT", timeframe: "1h" }]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ code: -1121, msg: "Invalid symbol" })));
    expect(await resolveTickerMarket({ symbol: "CARDSUSDT", timeframe: "1h" })).toBeUndefined();
  });

  it("annule la sonde en cours et ne confirme pas sa réponse tardive", async () => {
    vi.spyOn(routing, "resolveMarketCandidates").mockResolvedValue([{ exchange: "okx", symbol: "CARDSUSDT", timeframe: "1h" }]);
    let finish!: (r: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    const pending = resolveTickerMarket({ symbol: "CARDSUSDT", timeframe: "1h" }, controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(await pending).toBeUndefined();
    expect((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].signal?.aborted).toBe(true);
    finish(response({ code: "0", data: [cards] }));
    await vi.advanceTimersByTimeAsync(0);
  });

  it("borne une source muette puis tente le prix de la suivante", async () => {
    vi.spyOn(routing, "resolveMarketCandidates").mockResolvedValue([
      { exchange: "binance", symbol: "CARDSUSDT", timeframe: "1h" }, { exchange: "okx", symbol: "CARDSUSDT", timeframe: "1h" },
    ]);
    vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("okx.com") ? Promise.resolve(response({ code: "0", data: [cards] })) : new Promise(() => {})));
    const pending = resolveTickerMarket({ symbol: "CARDSUSDT", timeframe: "1h" });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await pending).toEqual({ exchange: "okx", symbol: "CARDSUSDT", timeframe: "1h" });
  });

  it("atteint aussi la dernière source après un catalogue lent et cinq sondes muettes", async () => {
    vi.spyOn(routing, "resolveMarketCandidates").mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve((["binance", "kraken", "coinbase", "bybit", "okx", "mexc"] as const)
        .map((exchange) => ({ exchange, symbol: "CARDSUSDT", timeframe: "1h" }))), 12_000);
    }));
    vi.stubGlobal("fetch", vi.fn((url: string) => url.startsWith("/mexcapi/")
      ? Promise.resolve(response({ symbol: "CARDSUSDT", lastPrice: "0.18", priceChangePercent: "20" }))
      : new Promise(() => {})));
    const pending = resolveTickerMarket({ symbol: "CARDSUSDT", timeframe: "1h" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await pending).toEqual({ exchange: "mexc", symbol: "CARDSUSDT", timeframe: "1h" });
  });

  it("la sonde Twelve Data n'envoie rien marché fermé (un crédit et un créneau 8/min par appel)", async () => {
    const fetcher = vi.fn(async () => response({ close: "200", percent_change: "1" }));
    vi.stubGlobal("fetch", fetcher);
    vi.setSystemTime(new Date("2026-09-26T15:00:00Z")); // samedi : bourse US fermée
    const ferme = resolveTickerMarket({ symbol: "AAPL", timeframe: "1h" });
    await vi.advanceTimersByTimeAsync(0);
    expect(await ferme).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
    vi.setSystemTime(new Date("2026-09-23T15:00:00Z")); // mercredi, séance ouverte
    const ouvert = resolveTickerMarket({ symbol: "AAPL", timeframe: "1h" });
    await vi.advanceTimersByTimeAsync(0);
    expect(await ouvert).toEqual({ exchange: "twelvedata", symbol: "AAPL", timeframe: "1h" });
    expect(fetcher.mock.calls.map((call) => String((call as unknown as [string])[0]))).toEqual(["/tdapi/quote?symbol=AAPL"]);
  });

  it("un abonnement sans provenance trouve OKX sans ouvrir de WebSocket Binance", async () => {
    vi.spyOn(routing, "resolveMarketCandidates").mockResolvedValue([{ exchange: "okx", symbol: "CARDSUSDT", timeframe: "1h" }]);
    const ws = vi.fn();
    vi.stubGlobal("WebSocket", ws);
    vi.stubGlobal("fetch", vi.fn(async () => response({ code: "0", data: [cards] })));
    const cb = vi.fn();
    const stop = subscribeTickers(["CARDSUSDT"], cb);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    expect(ws).not.toHaveBeenCalled();
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ symbol: "CARDSUSDT", price: 0.18 }));
  });

  it("un abonnement arrêté pendant le catalogue ne démarre aucun flux ensuite", async () => {
    let finish!: (r: routing.ResolvedMarket[]) => void;
    vi.spyOn(routing, "resolveMarketCandidates").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const stop = subscribeTickers(["CARDSUSDT"], vi.fn());
    stop();
    finish([{ exchange: "okx", symbol: "CARDSUSDT", timeframe: "1h" }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

it("les statistiques horaires respectent la source OKX confirmée", async () => {
  watchlistStore.getState().setAll(["CARDSUSDT"], { CARDSUSDT: "okx" });
  const klines = vi.spyOn(okxAdapter, "fetchKlines").mockResolvedValue([
    { time: 0, open: 0.15, high: 0.15, low: 0.15, close: 0.15, volume: 1 },
    { time: 3_600_000, open: 0.18, high: 0.18, low: 0.18, close: 0.18, volume: 1 },
  ]);
  const binance = vi.spyOn(binanceAdapter, "fetchKlines").mockResolvedValue([]);
  const cb = vi.fn();
  const stop = subscribeWatchlistBars(["CARDSUSDT"], cb);
  await vi.advanceTimersByTimeAsync(0);
  stop();
  expect(klines).toHaveBeenCalledWith("CARDSUSDT", "1h", { limit: 169 });
  expect(binance).not.toHaveBeenCalled();
  expect(cb).toHaveBeenCalledWith(expect.objectContaining({ symbol: "CARDSUSDT", change1h: expect.closeTo(20) }));
});
