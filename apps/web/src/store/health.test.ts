/**
 * Tests du store santé des sources (health.ts) — transitions d'état lues par le futur
 * panneau « santé des sources » et l'agent ticker. Une régression rendrait le panneau
 * muet ou trompeur (source affichée connectée alors qu'elle est en erreur, etc.).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { healthStore } from "./health";

beforeEach(() => {
  healthStore.setState({ sources: {} });
});

describe("healthStore", () => {
  it("setEtat crée l'entrée d'une source inconnue avec l'état demandé", () => {
    healthStore.getState().setEtat("binance", "connected");
    const s = healthStore.getState().sources["binance"];
    expect(s?.etat).toBe("connected");
    expect(s?.dernierMessageTs).toBe(0); // aucun message encore
  });

  it("marquerMessage horodate le dernier message et lève l'état 'stale' -> 'connected'", () => {
    healthStore.getState().setEtat("kraken", "stale");
    healthStore.getState().marquerMessage("kraken", 1234);

    const s = healthStore.getState().sources["kraken"];
    expect(s?.dernierMessageTs).toBe(1234);
    expect(s?.etat).toBe("connected"); // le flux reparle => plus stale
  });

  it("marquerMessage conserve un état non-stale (ex. reste 'connected')", () => {
    healthStore.getState().setEtat("kraken", "connected");
    healthStore.getState().marquerMessage("kraken", 5000);
    expect(healthStore.getState().sources["kraken"]?.etat).toBe("connected");
  });

  it("marquerErreur pose etat='error' + derniereErreur sans effacer le quota déjà posé", () => {
    healthStore.getState().setQuota("twelvedata", { utilise: 7, limite: 8, fenetre: "1min" });
    healthStore.getState().marquerErreur("twelvedata", "HTTP 429");

    const s = healthStore.getState().sources["twelvedata"];
    expect(s?.etat).toBe("error");
    expect(s?.derniereErreur).toBe("HTTP 429");
    expect(s?.quota).toEqual({ utilise: 7, limite: 8, fenetre: "1min" }); // préservé
  });

  it("setQuota met à jour le quota sans changer l'état courant", () => {
    healthStore.getState().setEtat("coinalyze", "polling");
    healthStore.getState().setQuota("coinalyze", { utilise: 40, limite: 40, fenetre: "1min" });

    const s = healthStore.getState().sources["coinalyze"];
    expect(s?.etat).toBe("polling"); // inchangé
    expect(s?.quota?.utilise).toBe(40);
  });

  it("setEtat fusionne un patch partiel (ex. dernierMessageTs) sans perdre les autres champs", () => {
    healthStore.getState().setEtat("binance", "connected", { dernierMessageTs: 999 });
    const s = healthStore.getState().sources["binance"];
    expect(s?.etat).toBe("connected");
    expect(s?.dernierMessageTs).toBe(999);
  });

  it("setQuota sur une source INCONNUE l'amorce en 'polling' (source REST à quota, pas WS)", () => {
    // Coinalyze/Twelve Data n'ont pas de gestionnaire d'état WS : leur 1er signal est le
    // quota. On veut alors "polling" (bleu-gris) et non "reconnecting" (orange trompeur).
    healthStore.getState().setQuota("coinalyze", { utilise: 3, limite: 40, fenetre: "1min" });
    expect(healthStore.getState().sources["coinalyze"]?.etat).toBe("polling");
  });

  it("setQuota conserve une composante journalière optionnelle (min + jour)", () => {
    healthStore
      .getState()
      .setQuota("twelvedata:quotes", { utilise: 3, limite: 8, fenetre: "1min", jour: { utilise: 142, limite: 800 } });
    expect(healthStore.getState().sources["twelvedata:quotes"]?.quota?.jour).toEqual({
      utilise: 142,
      limite: 800,
    });
  });

  it("retirer supprime la source du registre", () => {
    healthStore.getState().setEtat("binance:trades", "connected");
    healthStore.getState().retirer("binance:trades");
    expect(healthStore.getState().sources["binance:trades"]).toBeUndefined();
  });
});
