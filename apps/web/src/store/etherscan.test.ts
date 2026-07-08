import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { etherscanKeyStore, getEtherscanKey } from "./etherscan";

// Environnement de test Node (pas de DOM) : `localStorage` est absent par défaut ici,
// contrairement au navigateur. Même pattern de mock en mémoire que persist.test.ts /
// chart/drawing.test.ts (installMockLocalStorage).
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

describe("etherscanKeyStore", () => {
  beforeEach(() => {
    installMockLocalStorage();
    etherscanKeyStore.getState().clearKey();
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("aucune clé par défaut", () => {
    expect(etherscanKeyStore.getState().hasKey).toBe(false);
    expect(getEtherscanKey()).toBeNull();
  });

  it("setKey persiste et hasKey passe à true", () => {
    etherscanKeyStore.getState().setKey("abc123");
    expect(etherscanKeyStore.getState().hasKey).toBe(true);
    expect(getEtherscanKey()).toBe("abc123");
  });

  it("setKey avec chaîne vide équivaut à clearKey", () => {
    etherscanKeyStore.getState().setKey("abc123");
    etherscanKeyStore.getState().setKey("");
    expect(etherscanKeyStore.getState().hasKey).toBe(false);
  });

  it("clearKey supprime la clé", () => {
    etherscanKeyStore.getState().setKey("abc123");
    etherscanKeyStore.getState().clearKey();
    expect(etherscanKeyStore.getState().hasKey).toBe(false);
    expect(getEtherscanKey()).toBeNull();
  });
});
