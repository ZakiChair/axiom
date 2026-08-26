import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "axiom:fred:key";

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

describe("hasUsableFredKey", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../lib/deployment");
    installMockLocalStorage();
  });

  afterEach(() => {
    vi.doUnmock("../lib/deployment");
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("conserve le repli proxy en local et exige une clé personnelle sur Vercel", async () => {
    const { hasUsableFredKey } = await import("./macro");
    expect(hasUsableFredKey(null, false)).toBe(true);
    expect(hasUsableFredKey(null, true)).toBe(false);
    expect(hasUsableFredKey("   ", true)).toBe(false);
    expect(hasUsableFredKey("personnelle", true)).toBe(true);
  });

  it("garde hasKey vrai sans clé personnelle en local", async () => {
    const { fredKeyStore } = await import("./macro");
    expect(fredKeyStore.getState().hasKey).toBe(true);
    fredKeyStore.getState().clearKey();
    expect(fredKeyStore.getState().hasKey).toBe(true);
  });

  it("sur Vercel, hasKey suit uniquement localStorage sans exposer la valeur dans Zustand", async () => {
    vi.resetModules();
    vi.doMock("../lib/deployment", () => ({ IS_VERCEL: true }));
    const { fredKeyStore, getFredKey } = await import("./macro");

    expect(fredKeyStore.getState().hasKey).toBe(false);
    fredKeyStore.getState().setKey("  personnelle  ");
    expect(fredKeyStore.getState().hasKey).toBe(true);
    expect(getFredKey()).toBe("personnelle");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("personnelle");
    expect(Object.values(fredKeyStore.getState())).not.toContain("personnelle");

    fredKeyStore.getState().clearKey();
    expect(fredKeyStore.getState().hasKey).toBe(false);
    expect(getFredKey()).toBeNull();
  });
});
