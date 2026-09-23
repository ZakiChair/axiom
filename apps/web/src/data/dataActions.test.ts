import { describe, expect, it, vi } from "vitest";
import { actionsSourceData, executerActionData, type DependancesActionsData } from "./dataActions";

function dependances(): DependancesActionsData {
  return {
    actualiserEco: vi.fn(async () => {}),
    ouvrirReglages: vi.fn(async () => {}),
    ouvrirFenetre: vi.fn(async () => {}),
  };
}

describe("capacités des sources DATA", () => {
  it("ne fabrique aucune action pour une source inconnue", async () => {
    const capacites = actionsSourceData("source-inconnue");
    expect(capacites.actions).toEqual([]);
    expect(capacites.motif).toContain("Aucune action");
    const deps = dependances();
    await expect(executerActionData("source-inconnue", "actualiser", deps)).rejects.toThrow("indisponible");
    expect(deps.actualiserEco).not.toHaveBeenCalled();
    expect(deps.ouvrirReglages).not.toHaveBeenCalled();
  });

  it("réserve l'actualisation directe au calendrier et indique où agir ailleurs", () => {
    for (const source of ["eco:fred", "eco:forexfactory"]) {
      expect(actionsSourceData(source).actions.some((a) => a.id === "actualiser")).toBe(true);
    }
    for (const source of ["coinalyze", "bgeometrics", "macro:fred", "binance", "axiomd"]) {
      expect(actionsSourceData(source).actions.some((a) => a.id === "actualiser")).toBe(false);
      expect(actionsSourceData(source).motif.length).toBeGreaterThan(0);
    }
    expect(actionsSourceData("bgeometrics").actions).toContainEqual(expect.objectContaining({
      id: "vue", type: "fenetre", fenetre: "onchain",
    }));
  });

  it("propose les réglages seulement pour des clés configurables", () => {
    for (const source of ["coinalyze", "twelvedata:quotes", "eco:fred", "cryptoquant", "etherscan"]) {
      expect(actionsSourceData(source).actions.some((a) => a.id === "reglages")).toBe(true);
    }
    for (const source of ["eco:forexfactory", "mempool", "coinmetrics", "binance:trades"]) {
      expect(actionsSourceData(source).actions.some((a) => a.id === "reglages")).toBe(false);
    }
  });

  it("n'expose que des pages publiques fixes, sans clé ni URL issue de la source", () => {
    for (const source of ["eco:fred", "eco:forexfactory", "coinalyze", "twelvedata:quotes", "bgeometrics", "cryptoquant", "mempool", "binance:trades"]) {
      const liens = actionsSourceData(source).actions.filter((a) => a.type === "lien");
      expect(liens.length).toBeGreaterThan(0);
      for (const lien of liens) {
        if (lien.type !== "lien") continue;
        const url = new URL(lien.url);
        expect(url.protocol).toBe("https:");
        expect(url.username + url.password + url.search).toBe("");
      }
    }
    expect(actionsSourceData("https://example.com/?api_key=secret").actions).toEqual([]);
    expect(actionsSourceData("eco:fred?api_key=secret").actions).toEqual([]);
  });

  it("attend l'exécution réelle du rappel d'actualisation", async () => {
    const deps = dependances();
    let terminer!: () => void;
    deps.actualiserEco = vi.fn(() => new Promise<void>((resolve) => { terminer = resolve; }));
    let fini = false;
    const resultat = executerActionData("eco:fred", "actualiser", deps).then((message) => {
      fini = true;
      return message;
    });
    expect(deps.actualiserEco).toHaveBeenCalledWith("eco:fred");
    await Promise.resolve();
    expect(fini).toBe(false);
    terminer();
    expect(await resultat).toContain("actualisé");
  });

  it("navigue réellement vers les réglages et la fenêtre propriétaire", async () => {
    const deps = dependances();
    expect(await executerActionData("coinalyze", "reglages", deps)).toContain("Réglages");
    expect(deps.ouvrirReglages).toHaveBeenCalledOnce();
    expect(await executerActionData("bgeometrics", "vue", deps)).toContain("CHAIN");
    expect(deps.ouvrirFenetre).toHaveBeenCalledWith("onchain");
    expect(deps.actualiserEco).not.toHaveBeenCalled();
  });

  it("remonte l'échec d'une action sans empêcher celle d'une autre source", async () => {
    const deps = dependances();
    deps.actualiserEco = vi.fn(async () => { throw new Error("Quota atteint"); });
    await expect(executerActionData("eco:fred", "actualiser", deps)).rejects.toThrow("Quota atteint");
    await expect(executerActionData("coinalyze", "reglages", deps)).resolves.toContain("Réglages");
    expect(deps.ouvrirReglages).toHaveBeenCalledOnce();
  });

  it("refuse une action non proposée à cette source", async () => {
    const deps = dependances();
    await expect(executerActionData("binance", "actualiser", deps)).rejects.toThrow("indisponible");
    await expect(executerActionData("coinmetrics", "reglages", deps)).rejects.toThrow("indisponible");
    expect(deps.actualiserEco).not.toHaveBeenCalled();
    expect(deps.ouvrirReglages).not.toHaveBeenCalled();
  });
});
