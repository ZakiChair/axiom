import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { finnhubKeyStore, getFinnhubKey } from "./finnhub";

// Environnement de test Node (pas de DOM) : `localStorage` est absent par défaut ici,
// contrairement au navigateur. Même pattern de mock en mémoire que sosovalue.test.ts.
function installMockLocalStorage(): Storage {
  const data = new Map<string, string>();
  const mock: Storage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
    key: (i) => Array.from(data.keys())[i] ?? null,
    get length() {
      return data.size;
    },
  };
  (globalThis as { localStorage?: Storage }).localStorage = mock;
  return mock;
}

describe("finnhubKeyStore", () => {
  beforeEach(() => {
    installMockLocalStorage();
    finnhubKeyStore.getState().clearKey();
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("aucune clé par défaut", () => {
    expect(finnhubKeyStore.getState().hasKey).toBe(false);
    expect(getFinnhubKey()).toBeNull();
  });

  it("setKey persiste", () => {
    finnhubKeyStore.getState().setKey("xyz");
    expect(finnhubKeyStore.getState().hasKey).toBe(true);
    expect(getFinnhubKey()).toBe("xyz");
  });

  it("clearKey supprime la clé", () => {
    finnhubKeyStore.getState().setKey("xyz");
    finnhubKeyStore.getState().clearKey();
    expect(finnhubKeyStore.getState().hasKey).toBe(false);
    expect(getFinnhubKey()).toBeNull();
  });
});
