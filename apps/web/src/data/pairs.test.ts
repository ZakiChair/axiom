import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function json(value: unknown) { return { ok: true, json: async () => value }; }

describe("catalogues réels par marché", () => {
  it("ne sert pas les paires Binance à la place de Bybit spot", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("bybit")
      ? json({ retCode: 0, result: { list: [{ symbol: "SPECIALUSDT", status: "Trading" }, { symbol: "OLDUSDT", status: "Closed" }] } })
      : json({ symbols: [{ symbol: "BTCUSDT", status: "TRADING" }] })));
    const { fetchPairs } = await import("./pairs");
    expect(await fetchPairs("bybit")).toEqual(["SPECIALUSDT"]);
  });
  it("charge uniquement les instruments spot actifs OKX", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ code: "0", data: [
      { instId: "BTC-USDC", instType: "SPOT", state: "live" },
      { instId: "BTC-USDT-SWAP", instType: "SWAP", state: "live" },
      { instId: "OLD-USDT", instType: "SPOT", state: "suspend" },
    ] })));
    const { fetchPairs } = await import("./pairs");
    expect(await fetchPairs("okx")).toEqual(["BTCUSDC"]);
  });
  it("expose les perps Hyperliquid séparément et exclut les marchés retirés", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ universe: [{ name: "BTC" }, { name: "kPEPE" }, { name: "OLD", isDelisted: true }] })));
    const { fetchPairs } = await import("./pairs");
    expect(await fetchPairs("hyperliquid")).toEqual(["BTC-PERP", "KPEPE-PERP"]);
  });
});

it("borne un catalogue muet, l'évince et permet la tentative suivante", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  const { fetchPairs } = await import("./pairs");
  const pending = fetchPairs("binance");
  const rejection = expect(pending).rejects.toThrow("délai dépassé");
  await vi.advanceTimersByTimeAsync(12_000);
  await rejection;
  vi.stubGlobal("fetch", vi.fn(async () => json({ symbols: [{ symbol: "BTCUSDT", status: "TRADING" }] })));
  expect(await fetchPairs("binance")).toEqual(["BTCUSDT"]);
});

it("un catalogue bloqué ne supprime pas les actifs des autres places", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("binance")) return new Promise(() => {});
    if (url.includes("bybit")) return json({ retCode: 0, result: { list: [{ symbol: "SPECIALUSDT", status: "Trading" }] } });
    throw new Error("indisponible");
  }));
  const { fetchMarketCatalog } = await import("./marketRouting");
  const pending = fetchMarketCatalog();
  await vi.advanceTimersByTimeAsync(12_000);
  const catalog = await pending;
  expect(catalog.instruments).toContainEqual({ exchange: "bybit", symbol: "SPECIALUSDT", kind: "spot" });
  expect(catalog.unavailableSources).toContain("binance");
  expect(catalog.instruments).toContainEqual({ exchange: "synthetic", symbol: "TOTAL", kind: "synthetic" });
});

it("les ETF crypto restent recherchables dans le catalogue TradFi", async () => {
  const { fetchPairs } = await import("./pairs");
  expect(await fetchPairs("twelvedata")).toEqual(expect.arrayContaining(["GBTC", "IBIT", "ETHA", "ETHE"]));
});

it("référence séparément pétrole spot WTI/USD, action WTI et ETF USO", async () => {
  const { fetchPairs, isTradfiMarketSymbol } = await import("./pairs");
  expect(await fetchPairs("twelvedata")).toEqual(expect.arrayContaining(["WTI/USD", "WTI", "USO"]));
  expect(isTradfiMarketSymbol("WTI/USD")).toBe(true);
});

const cardsOkx = { code: "0", data: [{ instId: "CARDS-USDT", instType: "SPOT", state: "live" }] };

it("attend un catalogue OKX lent qui rend CARDSUSDT après six secondes", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => setTimeout(() => resolve(json(cardsOkx)), 6_000))));
  const { fetchPairs } = await import("./pairs");
  const result = fetchPairs("okx").catch((error: Error) => error.message);
  await vi.advanceTimersByTimeAsync(6_000);
  expect(await result).toEqual(["CARDSUSDT"]);
});

it("renouvelle un catalogue réussi après cinq minutes pour découvrir les nouveaux actifs", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValueOnce(json({ code: "0", data: [{ instId: "BTC-USDT", instType: "SPOT", state: "live" }] }))
    .mockResolvedValue(json(cardsOkx));
  vi.stubGlobal("fetch", fetch);
  const { fetchPairs } = await import("./pairs");
  expect(await fetchPairs("okx")).toEqual(["BTCUSDT"]);
  await vi.advanceTimersByTimeAsync(299_999);
  expect(await fetchPairs("okx")).toEqual(["BTCUSDT"]);
  await vi.advanceTimersByTimeAsync(1);
  expect(await fetchPairs("okx")).toEqual(["CARDSUSDT"]);
});

it("ne mémorise pas indéfiniment une liste vide après une anomalie fournisseur", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ code: "0", data: [] })).mockResolvedValue(json(cardsOkx)));
  const { fetchPairs } = await import("./pairs");
  expect(await fetchPairs("okx")).toEqual([]);
  expect(await fetchPairs("okx")).toEqual(["CARDSUSDT"]);
});

it("force renouvelle les données terminées et déduplique le rafraîchissement concurrent", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValueOnce(json({ code: "0", data: [{ instId: "BTC-USDT", instType: "SPOT", state: "live" }] }))
    .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(json(cardsOkx)), 50)));
  vi.stubGlobal("fetch", fetch);
  const { fetchPairs } = await import("./pairs");
  await fetchPairs("okx");
  const first = fetchPairs("okx", { force: true });
  const second = fetchPairs("okx", { force: true });
  expect(first).toBe(second);
  await vi.advanceTimersByTimeAsync(50);
  expect(await first).toEqual(["CARDSUSDT"]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("un rafraîchissement échoué ne remet pas en circulation le précédent catalogue", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json(cardsOkx)).mockRejectedValueOnce(new Error("HTTP 503"))
    .mockResolvedValue(json({ code: "0", data: [{ instId: "BTC-USDT", instType: "SPOT", state: "live" }] })));
  const { fetchPairs } = await import("./pairs");
  await fetchPairs("okx");
  await expect(fetchPairs("okx", { force: true })).rejects.toThrow("503");
  expect(await fetchPairs("okx")).toEqual(["BTCUSDT"]);
});
