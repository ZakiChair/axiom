/**
 * Couche LIQHL sur VERCEL (`IS_VERCEL` vrai) : mode navigateur d'emblée — aucun appel au
 * daemon (injoignable sur Vercel), scanner paresseux démarré à l'activation, un seul
 * instantané pour tous les coins, arrêt propre au OFF. Fichier séparé : `IS_VERCEL` est une
 * constante de module, figée ici par le mock de lib/deployment.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

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
    await vi.waitFor(() => expect(nav.scanner.demarrer).toHaveBeenCalledWith("BTC", true));
    expect(hlLiqLevelsGet).not.toHaveBeenCalled();
    expect(kvPut).not.toHaveBeenCalled(); // pas de drapeau de collecte daemon

    nav.publier?.({ etat: "chargement", niveaux: [], ts: 0, adressesScannees: 0, progression: { faites: 0, total: 1500 } });
    expect(hlLiqStore.getState().progression).toEqual({ faites: 0, total: 1500 });

    marketStore.getState().setSymbol("SOLUSDT");
    expect(nav.scanner.definirCoin).toHaveBeenLastCalledWith("SOL", true);
    expect(nav.scanner.demarrer).toHaveBeenCalledOnce();

    hlLiqStore.getState().setActif(false);
    expect(nav.scanner.arreter).toHaveBeenCalledOnce();
    expect(hlLiqStore.getState()).toMatchObject({ etat: "vide", niveaux: [], progression: null });

    // Réactivation : le MÊME scanner (chunk déjà chargé) est redémarré, toujours sans daemon.
    hlLiqStore.getState().setActif(true);
    expect(nav.scanner.demarrer).toHaveBeenCalledTimes(2);
    expect(nav.scanner.demarrer).toHaveBeenLastCalledWith("SOL", true);
    expect(hlLiqLevelsGet).not.toHaveBeenCalled();
    hlLiqStore.getState().setActif(false);
  });
});

describe("LIQHL sur Vercel — aucun scan sans actif perp", () => {
  // Couche éteinte après chaque cas, même en échec : l'activation suivante doit relancer le scanner.
  afterEach(() => hlLiqStore.getState().setActif(false));

  it("EUR/USD (Twelve Data) et STABLE.D : scanner activé sans coin ; le premier perp lui donne BTC", async () => {
    demarrerHyperliquidLiq();
    for (const [exchange, symbol] of [["twelvedata", "EUR/USD"], ["synthetic", "STABLE.D"]] as const) {
      marketStore.getState().setMarket({ exchange, symbol, timeframe: "1d" });
      nav.scanner.demarrer.mockClear();
      hlLiqStore.getState().setActif(true);
      await vi.waitFor(() => expect(nav.scanner.demarrer).toHaveBeenCalled());
      expect(nav.scanner.demarrer, symbol).toHaveBeenLastCalledWith(null, false);
      hlLiqStore.getState().setActif(false);
    }
    hlLiqStore.getState().setActif(true);
    nav.scanner.definirCoin.mockClear();
    marketStore.getState().setSymbol("BTCUSDT");
    expect(nav.scanner.definirCoin).toHaveBeenLastCalledWith("BTC", true);
    hlLiqStore.getState().setActif(false);
  });

  // Revue du 30/10 : « Voir sur le chart » d'une alerte {synthetic, BTCUSDT} pose ce couple (sans
  // perp), puis le graphe republie l'identité routée {binance, BTCUSDT} — changement de SOURCE seul.
  it("premier perp atteint par un changement de source seul : le scanner reçoit le perp", async () => {
    demarrerHyperliquidLiq();
    marketStore.getState().setMarket({ exchange: "synthetic", symbol: "STABLE.D", timeframe: "1d" });
    nav.scanner.demarrer.mockClear();
    hlLiqStore.getState().setActif(true);
    await vi.waitFor(() => expect(nav.scanner.demarrer).toHaveBeenLastCalledWith(null, false));
    nav.scanner.definirCoin.mockClear();
    marketStore.getState().setMarket({ exchange: "synthetic", symbol: "BTCUSDT", timeframe: "1h" });
    expect(nav.scanner.definirCoin).toHaveBeenLastCalledWith(null, false);
    marketStore.getState().setExchange("binance");
    expect(nav.scanner.definirCoin).toHaveBeenLastCalledWith("BTC", true);
    hlLiqStore.getState().setActif(false);
  });

  it("vrais perps sans coin affiché (SUSDT, BROCCOLI714USDT, BTCUSD1) : scan lancé, comme avant", async () => {
    demarrerHyperliquidLiq();
    for (const [exchange, symbol] of [["bybit", "SUSDT"], ["binance", "BROCCOLI714USDT"], ["binance", "BTCUSD1"]] as const) {
      marketStore.getState().setMarket({ exchange, symbol, timeframe: "1h" });
      nav.scanner.demarrer.mockClear();
      hlLiqStore.getState().setActif(true);
      await vi.waitFor(() => expect(nav.scanner.demarrer).toHaveBeenCalled());
      expect(nav.scanner.demarrer, symbol).toHaveBeenLastCalledWith(null, true);
      hlLiqStore.getState().setActif(false);
    }
  });
});
