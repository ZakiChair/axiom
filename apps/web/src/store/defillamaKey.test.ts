import { beforeEach, describe, expect, it, vi } from "vitest";
import { defillamaKeyStore, getDefillamaProKey } from "./defillamaKey";

describe("clé DefiLlama Pro", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k), clear: () => values.clear() });
  });
  it("stocke hors du préfixe exporté et n'expose que présence/version", () => {
    defillamaKeyStore.getState().setKey(" secret-personnel ");
    expect(localStorage.getItem("axiom.defillama.proApiKey")).toBe("secret-personnel");
    expect(getDefillamaProKey()).toBe("secret-personnel");
    const state = defillamaKeyStore.getState() as unknown as Record<string, unknown>;
    expect(state.key).toBeUndefined();
    expect(state.hasKey).toBe(true);
  });
});
