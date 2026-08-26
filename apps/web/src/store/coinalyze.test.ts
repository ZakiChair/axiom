import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "axiom:coinalyze:key";

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

describe("hasUsableCoinalyzeKey", () => {
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
    const { hasUsableCoinalyzeKey } = await import("./coinalyze");
    expect(hasUsableCoinalyzeKey(null, false)).toBe(true);
    expect(hasUsableCoinalyzeKey(null, true)).toBe(false);
    expect(hasUsableCoinalyzeKey("   ", true)).toBe(false);
    expect(hasUsableCoinalyzeKey("personnelle", true)).toBe(true);
  });

  it("garde hasKey vrai sans clé personnelle en local", async () => {
    const { coinalyzeKeyStore } = await import("./coinalyze");
    expect(coinalyzeKeyStore.getState().hasKey).toBe(true);
    coinalyzeKeyStore.getState().clearKey();
    expect(coinalyzeKeyStore.getState().hasKey).toBe(true);
  });

  it("sur Vercel, hasKey suit uniquement localStorage sans exposer la valeur dans Zustand", async () => {
    vi.resetModules();
    vi.doMock("../lib/deployment", () => ({ IS_VERCEL: true }));
    const { coinalyzeKeyStore } = await import("./coinalyze");

    expect(coinalyzeKeyStore.getState().hasKey).toBe(false);
    coinalyzeKeyStore.getState().setKey("  personnelle  ");
    expect(coinalyzeKeyStore.getState().hasKey).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("personnelle");
    expect(Object.values(coinalyzeKeyStore.getState())).not.toContain("personnelle");

    coinalyzeKeyStore.getState().clearKey();
    expect(coinalyzeKeyStore.getState().hasKey).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
