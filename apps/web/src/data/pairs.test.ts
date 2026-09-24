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

it("borne un catalogue muet, l'évince et permet la tentative suivante après la fenêtre d'échec", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  const { fetchPairs } = await import("./pairs");
  const pending = fetchPairs("binance");
  const rejection = expect(pending).rejects.toThrow("délai dépassé");
  await vi.advanceTimersByTimeAsync(12_000);
  await rejection;
  const reprise = vi.fn(async () => json({ symbols: [{ symbol: "BTCUSDT", status: "TRADING" }] }));
  vi.stubGlobal("fetch", reprise);
  // L'échec reste mémorisé 30 s : aucune nouvelle attente de 12 s à chaque ouverture.
  await expect(fetchPairs("binance")).rejects.toThrow("délai dépassé");
  expect(reprise).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(30_000);
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
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValueOnce(json(cardsOkx)).mockRejectedValueOnce(new Error("HTTP 503"))
    .mockResolvedValue(json({ code: "0", data: [{ instId: "BTC-USDT", instType: "SPOT", state: "live" }] }));
  vi.stubGlobal("fetch", fetch);
  const { fetchPairs } = await import("./pairs");
  await fetchPairs("okx");
  await expect(fetchPairs("okx", { force: true })).rejects.toThrow("503");
  // Pendant la fenêtre d'échec, ni CARDSUSDT (ancien succès) ni nouvel appel réseau.
  await expect(fetchPairs("okx")).rejects.toThrow("503");
  expect(fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(await fetchPairs("okx")).toEqual(["BTCUSDT"]);
});

describe("échecs mémorisés par source", () => {
  it("un échec est gardé 30 s sans rappeler le réseau ; force passe outre", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValueOnce(new Error("HTTP 502")).mockRejectedValueOnce(new Error("HTTP 504"))
      .mockResolvedValue(json(cardsOkx));
    vi.stubGlobal("fetch", fetch);
    const { fetchPairs } = await import("./pairs");
    await expect(fetchPairs("okx")).rejects.toThrow("502");
    await vi.advanceTimersByTimeAsync(29_999);
    await expect(fetchPairs("okx")).rejects.toThrow("502");
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(fetchPairs("okx", { force: true })).rejects.toThrow("504");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await fetchPairs("okx", { force: true })).toEqual(["CARDSUSDT"]);
    expect(await fetchPairs("okx")).toEqual(["CARDSUSDT"]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("l'expiration publiée d'une source en échec est la fin de sa fenêtre, jamais un ancien succès périmé", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json(cardsOkx)).mockRejectedValue(new Error("HTTP 503")));
    const { fetchPairs, pairsCacheExpiresAt } = await import("./pairs");
    await fetchPairs("okx");
    expect(pairsCacheExpiresAt("okx")).toBe(300_000);
    await vi.advanceTimersByTimeAsync(300_000);
    await expect(fetchPairs("okx")).rejects.toThrow("503");
    expect(pairsCacheExpiresAt("okx")).toBe(330_000);
  });

  it("une liste vide après un échec lève la fenêtre sans resservir l'ancien succès", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const fetch = vi.fn().mockResolvedValueOnce(json(cardsOkx)).mockRejectedValueOnce(new Error("HTTP 503"))
      .mockResolvedValueOnce(json({ code: "0", data: [] })).mockResolvedValue(json({ code: "0", data: [{ instId: "BTC-USDT", instType: "SPOT", state: "live" }] }));
    vi.stubGlobal("fetch", fetch);
    const { fetchPairs, pairsCacheExpiresAt } = await import("./pairs");
    await fetchPairs("okx");
    await expect(fetchPairs("okx", { force: true })).rejects.toThrow("503");
    expect(await fetchPairs("okx", { force: true })).toEqual([]);
    // Ni fin de fenêtre passée (agrégat expiré en boucle), ni CARDSUSDT remis en circulation.
    expect(pairsCacheExpiresAt("okx")).toBeUndefined();
    expect(await fetchPairs("okx")).toEqual(["BTCUSDT"]);
  });
});

describe("appels de catalogue réellement joignables depuis le navigateur", () => {
  it("Coinbase passe par le proxy /extapi : api.coinbase.com n'expose aucun en-tête CORS", async () => {
    const fetch = vi.fn(async (_url: string) => json({ products: [
      { product_id: "BTC-USDC", product_type: "SPOT" },
      { product_id: "OLD-USD", product_type: "SPOT", trading_disabled: true },
      { product_id: "BTC-PERP-INTX", product_type: "FUTURE" },
    ] }));
    vi.stubGlobal("fetch", fetch);
    const { fetchPairs } = await import("./pairs");
    expect(await fetchPairs("coinbase")).toEqual(["BTCUSDC"]);
    expect(String(fetch.mock.calls[0]?.[0])).toBe("/extapi/api.coinbase.com/api/v3/brokerage/market/products");
  });

  it("Binance demande la liste allégée des paires TRADING, avec le même jeu de symboles", async () => {
    // Réponse complète : tous statuts et permissionSets ; réponse allégée : TRADING seulement.
    const complete = { symbols: [
      { symbol: "ETHUSDT", status: "TRADING", permissionSets: [["SPOT"]] },
      { symbol: "LUNAUSDT", status: "BREAK", permissionSets: [["SPOT"]] },
      { symbol: "BTCUSDT", status: "TRADING", permissionSets: [["SPOT", "MARGIN"]] },
      { symbol: "OLDUSDT", status: "HALT", permissionSets: [] },
    ] };
    const allegee = { symbols: complete.symbols.filter((s) => s.status === "TRADING").map(({ symbol, status }) => ({ symbol, status })) };
    const fetch = vi.fn(async (url: string) => {
      const params = new URL(url).searchParams;
      return json(params.get("symbolStatus") === "TRADING" && params.get("showPermissionSets") === "false" ? allegee : complete);
    });
    vi.stubGlobal("fetch", fetch);
    const { fetchPairs } = await import("./pairs");
    const attendu = complete.symbols.filter((s) => s.status === "TRADING").map((s) => s.symbol).sort();
    expect(await fetchPairs("binance")).toEqual(attendu);
    const url = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe("https://api.binance.com/api/v3/exchangeInfo");
    expect(url.searchParams.get("symbolStatus")).toBe("TRADING");
    expect(url.searchParams.get("showPermissionSets")).toBe("false");
  });
});
