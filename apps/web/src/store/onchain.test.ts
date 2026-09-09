import { beforeEach, describe, expect, it, vi } from "vitest";

function stockage(): Storage {
  const valeurs = new Map<string, string>();
  return {
    getItem: (k) => valeurs.get(k) ?? null,
    setItem: (k, v) => void valeurs.set(k, v),
    removeItem: (k) => void valeurs.delete(k),
    clear: () => valeurs.clear(),
    key: (i) => [...valeurs.keys()][i] ?? null,
    get length() { return valeurs.size; },
  };
}

describe("clé BGeometrics", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", stockage());
  });

  it("incrémente une version sans secret même lors d'une rotation vraie→vraie", async () => {
    const { bgeometricsKeyStore } = await import("./onchain");
    bgeometricsKeyStore.getState().setKey("premiere-cle");
    const apresPremiere = bgeometricsKeyStore.getState();
    bgeometricsKeyStore.getState().setKey("seconde-cle");
    const apresRotation = bgeometricsKeyStore.getState();
    expect(apresPremiere.hasKey).toBe(true);
    expect(apresRotation.hasKey).toBe(true);
    expect(apresRotation.version).toBe(apresPremiere.version + 1);
    expect(JSON.stringify(apresRotation)).not.toContain("seconde-cle");
  });
});
