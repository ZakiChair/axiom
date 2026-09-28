import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
describe("préférence du bandeau d'actualités", () => {
  it.each([null, "cassé", "null", "1", '"true"'])("reste masqué sans préférence booléenne valide : %s", async (valeur) => {
    vi.stubGlobal("localStorage", { getItem: () => valeur });
    const { tickerBandStore } = await import("./tickerBand");
    expect(tickerBandStore.getState().visible).toBe(false);
  });
  it.each([true, false])("honore la préférence explicite %s et sa bascule après rechargement", async (visible) => {
    let sauvegarde = JSON.stringify(visible);
    vi.stubGlobal("localStorage", { getItem: () => sauvegarde, setItem: (_cle: string, valeur: string) => { sauvegarde = valeur; } });
    const { tickerBandStore, commandes } = await import("./tickerBand");
    expect(tickerBandStore.getState().visible).toBe(visible);
    commandes[0]!.action();
    expect(tickerBandStore.getState().visible).toBe(!visible);
    vi.resetModules();
    const recharge = await import("./tickerBand");
    expect(recharge.tickerBandStore.getState().visible).toBe(!visible);
  });
});
