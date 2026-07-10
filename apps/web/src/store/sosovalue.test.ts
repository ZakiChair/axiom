import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { soSoValueKeyStore, getSoSoValueKey } from "./sosovalue";

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

describe("soSoValueKeyStore", () => {
  beforeEach(() => {
    installMockLocalStorage();
    soSoValueKeyStore.getState().clearKey();
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("aucune clé par défaut", () => {
    expect(soSoValueKeyStore.getState().hasKey).toBe(false);
    expect(getSoSoValueKey()).toBeNull();
  });

  it("setKey persiste et hasKey passe à true", () => {
    soSoValueKeyStore.getState().setKey("abc123");
    expect(soSoValueKeyStore.getState().hasKey).toBe(true);
    expect(getSoSoValueKey()).toBe("abc123");
  });

  it("setKey avec chaîne vide équivaut à clearKey", () => {
    soSoValueKeyStore.getState().setKey("abc123");
    soSoValueKeyStore.getState().setKey("");
    expect(soSoValueKeyStore.getState().hasKey).toBe(false);
  });

  it("clearKey supprime la clé", () => {
    soSoValueKeyStore.getState().setKey("abc123");
    soSoValueKeyStore.getState().clearKey();
    expect(soSoValueKeyStore.getState().hasKey).toBe(false);
    expect(getSoSoValueKey()).toBeNull();
  });

  it("version s'incrémente à chaque setKey/clearKey — y compris en REMPLAÇANT une clé (hasKey reste true)", () => {
    const v0 = soSoValueKeyStore.getState().version;
    soSoValueKeyStore.getState().setKey("ancienne");
    soSoValueKeyStore.getState().setKey("nouvelle"); // hasKey true→true, seul version bouge
    expect(soSoValueKeyStore.getState().version).toBe(v0 + 2);
    soSoValueKeyStore.getState().clearKey();
    expect(soSoValueKeyStore.getState().version).toBe(v0 + 3);
  });
});
