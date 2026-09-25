/**
 * Couche LIQHL sur VERCEL (`IS_VERCEL` vrai) : mode navigateur d'emblée — aucun appel au
 * daemon (injoignable sur Vercel), scanner paresseux démarré à l'activation, un seul
 * instantané pour tous les coins, arrêt propre au OFF. Fichier séparé : `IS_VERCEL` est une
 * constante de module, figée ici par le mock de lib/deployment.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/deployment", () => ({ IS_VERCEL: true, isVercelDeployment: (v: unknown) => v === "vercel" }));
vi.mock("./daemon", () => ({
  hlLiqLevelsGet: vi.fn(async () => null),
  daemonSupporteHl: vi.fn(() => false),
  kvPut: vi.fn(async () => null),
}));
const nav = vi.hoisted(() => ({
  scanner: { demarrer: vi.fn(), definirCoin: vi.fn(), arreter: vi.fn(), attendreCycle: vi.fn(async () => {}) },
  publier: null as null | ((p: unknown) => void),
}));
vi.mock("./hyperliquidLiqNavigateur", () => ({
  scannerNavigateurHl: (publier: (p: unknown) => void) => {
    nav.publier = publier;
    return nav.scanner;
  },
}));

import { commandes, demarrerHyperliquidLiq, hlLiqStore } from "./hyperliquidLiq";
import { hlLiqLevelsGet, kvPut } from "./daemon";
import { marketStore } from "../store/market";

describe("LIQHL sur Vercel — scan navigateur", () => {
  it("la commande n'est plus UNUSABLE et décrit le scan navigateur", () => {
    const cmd = commandes.find((c) => c.mnemonique === "LIQHL");
    expect(cmd?.libelle).not.toContain("UNUSABLE");
    expect(cmd?.apercu).toContain("navigateur");
  });

  it("activation → scanner démarré sans aucun appel daemon ; coin changé → republié ; OFF → arrêté", async () => {
    marketStore.getState().setSymbol("BTCUSDT");
    demarrerHyperliquidLiq();
    hlLiqStore.getState().setActif(true);
    expect(hlLiqStore.getState()).toMatchObject({ etat: "chargement", source: "navigateur" });
    await vi.waitFor(() => expect(nav.scanner.demarrer).toHaveBeenCalledWith("BTC"));
    expect(hlLiqLevelsGet).not.toHaveBeenCalled();
    expect(kvPut).not.toHaveBeenCalled(); // pas de drapeau de collecte daemon

    nav.publier?.({ etat: "chargement", niveaux: [], ts: 0, adressesScannees: 0, progression: { faites: 0, total: 1500 } });
    expect(hlLiqStore.getState().progression).toEqual({ faites: 0, total: 1500 });

    marketStore.getState().setSymbol("SOLUSDT");
    expect(nav.scanner.definirCoin).toHaveBeenLastCalledWith("SOL");
    expect(nav.scanner.demarrer).toHaveBeenCalledOnce();

    hlLiqStore.getState().setActif(false);
    expect(nav.scanner.arreter).toHaveBeenCalledOnce();
    expect(hlLiqStore.getState()).toMatchObject({ etat: "vide", niveaux: [], progression: null });

    // Réactivation : le MÊME scanner (chunk déjà chargé) est redémarré, toujours sans daemon.
    hlLiqStore.getState().setActif(true);
    expect(nav.scanner.demarrer).toHaveBeenCalledTimes(2);
    expect(nav.scanner.demarrer).toHaveBeenLastCalledWith("SOL");
    expect(hlLiqLevelsGet).not.toHaveBeenCalled();
    hlLiqStore.getState().setActif(false);
  });
});
