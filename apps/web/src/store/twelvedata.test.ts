import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "axiom:twelvedata:key";

function installMockLocalStorage(): Storage {
  const data = new Map<string, string>();
  const mock: Storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    clear: () => data.clear(),
    key: (index) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  };
  (globalThis as { localStorage?: Storage }).localStorage = mock;
  return mock;
}

async function fetchQuoteUrl(): Promise<string> {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL) => ({
    status: 200,
    statusText: "OK",
    json: async () => ({ symbol: "AAPL", close: "100", percent_change: "1" }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  const { fetchQuotes } = await import("../data/twelvedata");
  await fetchQuotes(["AAPL"]);
  return String(fetchMock.mock.calls[0]?.[0]);
}

describe("twelveDataKeyStore", () => {
  beforeEach(() => {
    vi.resetModules();
    installMockLocalStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("démarre sans clé personnelle et ne place aucune valeur dans Zustand", async () => {
    const { twelveDataKeyStore } = await import("./twelvedata");
    expect(twelveDataKeyStore.getState().hasKey).toBe(false);
    expect(twelveDataKeyStore.getState()).not.toHaveProperty("key");
    expect(await fetchQuoteUrl()).toBe("/tdapi/quote?symbol=AAPL");
  });

  it("setKey normalise, persiste et injecte la clé dans le provider sans l'exposer dans le state", async () => {
    const { twelveDataKeyStore } = await import("./twelvedata");
    twelveDataKeyStore.getState().setKey("  personnelle&1  ");

    expect(twelveDataKeyStore.getState().hasKey).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("personnelle&1");
    expect(Object.values(twelveDataKeyStore.getState())).not.toContain("personnelle&1");
    expect(await fetchQuoteUrl()).toBe("/tdapi/quote?symbol=AAPL&apikey=personnelle%261");
  });

  it("hydrate le provider depuis localStorage au chargement", async () => {
    localStorage.setItem(STORAGE_KEY, "persistée");
    const { twelveDataKeyStore } = await import("./twelvedata");

    expect(twelveDataKeyStore.getState().hasKey).toBe(true);
    expect(await fetchQuoteUrl()).toBe("/tdapi/quote?symbol=AAPL&apikey=persist%C3%A9e");
  });

  it("clearKey et setKey vide retirent la clé du stockage et du provider", async () => {
    const { twelveDataKeyStore } = await import("./twelvedata");
    twelveDataKeyStore.getState().setKey("personnelle");
    twelveDataKeyStore.getState().clearKey();

    expect(twelveDataKeyStore.getState().hasKey).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(await fetchQuoteUrl()).toBe("/tdapi/quote?symbol=AAPL");

    twelveDataKeyStore.getState().setKey("personnelle");
    twelveDataKeyStore.getState().setKey("   ");
    expect(twelveDataKeyStore.getState().hasKey).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
