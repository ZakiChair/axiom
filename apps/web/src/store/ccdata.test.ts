import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "axiom:ccdata:key";

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

describe("ccdataKeyStore", () => {
  beforeEach(() => {
    vi.resetModules();
    installMockLocalStorage();
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("démarre sans clé et ne l'expose jamais dans Zustand", async () => {
    const { ccdataKeyStore, getCcDataApiKey } = await import("./ccdata");
    expect(ccdataKeyStore.getState().hasKey).toBe(false);
    expect(getCcDataApiKey()).toBeNull();
    expect(ccdataKeyStore.getState()).not.toHaveProperty("key");
  });

  it("normalise, persiste et relit la clé à la demande", async () => {
    const { ccdataKeyStore, getCcDataApiKey } = await import("./ccdata");
    ccdataKeyStore.getState().setKey("  personnelle&1  ");

    expect(ccdataKeyStore.getState().hasKey).toBe(true);
    expect(ccdataKeyStore.getState().revision).toBe(1);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("personnelle&1");
    expect(getCcDataApiKey()).toBe("personnelle&1");
    expect(Object.values(ccdataKeyStore.getState())).not.toContain("personnelle&1");
  });

  it("hydrate puis supprime la clé", async () => {
    localStorage.setItem(STORAGE_KEY, "persistée");
    const { ccdataKeyStore, getCcDataApiKey } = await import("./ccdata");

    expect(ccdataKeyStore.getState().hasKey).toBe(true);
    ccdataKeyStore.getState().clearKey();
    expect(ccdataKeyStore.getState().hasKey).toBe(false);
    expect(getCcDataApiKey()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
