/**
 * Tests du store watchlist — groupes/onglets (roadmap 1.4) + suivi de la SOURCE
 * d'origine par symbole (roadmap 0.4b). Points vérifiés :
 *  - `symbols` reste un MIROIR fidèle du groupe actif (rétro-compat persist.ts) ;
 *  - add/remove/move opèrent sur le groupe actif ;
 *  - la map `sources` reste creuse (purge des orphelins).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_WATCHLIST, PRINCIPAL_GROUP_ID, watchlistStore } from "./watchlist";

beforeEach(() => {
  // Réinitialise via setAll => un unique groupe « Principal » (état de départ propre).
  watchlistStore.getState().setAll([...DEFAULT_WATCHLIST]);
});

describe("watchlistStore — symboles & sources (groupe actif)", () => {
  it("add sans source n'inscrit rien dans la map (routage par inférence)", () => {
    watchlistStore.getState().add("bnbusdt");
    const s = watchlistStore.getState();
    expect(s.symbols).toContain("BNBUSDT"); // normalisé en majuscules + miroir à jour
    expect(s.sources["BNBUSDT"]).toBeUndefined(); // pas de source explicite
  });

  it("add avec source fige la provenance sous la clé majuscule", () => {
    watchlistStore.getState().add("btcusd", "kraken");
    expect(watchlistStore.getState().sources["BTCUSD"]).toBe("kraken");
  });

  it("add ignore un doublon du groupe actif (n'écrase pas la source déjà posée)", () => {
    watchlistStore.getState().add("BTCUSD", "kraken");
    watchlistStore.getState().add("BTCUSD", "coinbase"); // doublon → ignoré
    const s = watchlistStore.getState();
    expect(s.symbols.filter((x) => x === "BTCUSD")).toHaveLength(1);
    expect(s.sources["BTCUSD"]).toBe("kraken"); // inchangé
  });

  it("remove purge le symbole ET sa source (plus présent dans aucun groupe)", () => {
    watchlistStore.getState().add("BTCUSD", "kraken");
    watchlistStore.getState().remove("BTCUSD");
    const s = watchlistStore.getState();
    expect(s.symbols).not.toContain("BTCUSD");
    expect(s.sources["BTCUSD"]).toBeUndefined();
  });

  it("setAll remplace la liste par un unique groupe « Principal » et réinitialise les sources", () => {
    watchlistStore.getState().add("BTCUSD", "kraken");
    watchlistStore.getState().setAll(["ETHUSDT", "SOLUSDT"]);
    const s = watchlistStore.getState();
    expect(s.symbols).toEqual(["ETHUSDT", "SOLUSDT"]);
    expect(s.groups).toHaveLength(1);
    expect(s.activeGroupId).toBe(PRINCIPAL_GROUP_ID);
    expect(s.sources).toEqual({}); // sources non fournies → réinitialisées
  });
});

describe("watchlistStore — réordonnancement (move)", () => {
  it("monte un symbole (dir=-1) en l'échangeant avec son voisin du dessus", () => {
    // DEFAULT_WATCHLIST = [BTCUSDT, ETHUSDT, SOLUSDT] ; monter SOLUSDT le passe en 2e position.
    watchlistStore.getState().move("SOLUSDT", -1);
    expect(watchlistStore.getState().symbols).toEqual(["BTCUSDT", "SOLUSDT", "ETHUSDT"]);
  });

  it("descend un symbole (dir=+1) en l'échangeant avec son voisin du dessous", () => {
    watchlistStore.getState().move("BTCUSDT", 1);
    expect(watchlistStore.getState().symbols).toEqual(["ETHUSDT", "BTCUSDT", "SOLUSDT"]);
  });

  it("no-op si le déplacement sort des bornes (1er vers le haut / dernier vers le bas)", () => {
    watchlistStore.getState().move("BTCUSDT", -1); // déjà en tête
    expect(watchlistStore.getState().symbols).toEqual([...DEFAULT_WATCHLIST]);
    watchlistStore.getState().move("SOLUSDT", 1); // déjà en queue
    expect(watchlistStore.getState().symbols).toEqual([...DEFAULT_WATCHLIST]);
  });
});

describe("watchlistStore — groupes/onglets", () => {
  it("addGroup crée un onglet vide et le rend actif (miroir vidé)", () => {
    watchlistStore.getState().addGroup("DeFi");
    const s = watchlistStore.getState();
    expect(s.groups).toHaveLength(2);
    expect(s.groups[1]?.name).toBe("DeFi");
    expect(s.activeGroupId).toBe(s.groups[1]?.id);
    expect(s.symbols).toEqual([]); // le nouveau groupe est vide
  });

  it("add vise le groupe ACTIF sans polluer les autres onglets", () => {
    watchlistStore.getState().addGroup("DeFi");
    watchlistStore.getState().add("UNIUSDT");
    const s = watchlistStore.getState();
    expect(s.symbols).toEqual(["UNIUSDT"]); // ajouté au groupe DeFi (actif)
    // Le groupe Principal garde ses symboles d'origine.
    expect(s.groups.find((g) => g.id === PRINCIPAL_GROUP_ID)?.symbols).toEqual([...DEFAULT_WATCHLIST]);
  });

  it("setActiveGroup bascule le miroir sur les symboles de l'onglet ciblé", () => {
    watchlistStore.getState().addGroup("DeFi"); // devient actif (vide)
    watchlistStore.getState().setActiveGroup(PRINCIPAL_GROUP_ID);
    expect(watchlistStore.getState().symbols).toEqual([...DEFAULT_WATCHLIST]);
  });

  it("setActiveGroup ignore un id inconnu", () => {
    watchlistStore.getState().setActiveGroup("inexistant");
    expect(watchlistStore.getState().activeGroupId).toBe(PRINCIPAL_GROUP_ID);
  });

  it("removeGroup supprime l'onglet actif et bascule sur le premier restant", () => {
    watchlistStore.getState().addGroup("DeFi"); // actif
    const defiId = watchlistStore.getState().activeGroupId;
    watchlistStore.getState().removeGroup(defiId);
    const s = watchlistStore.getState();
    expect(s.groups).toHaveLength(1);
    expect(s.activeGroupId).toBe(PRINCIPAL_GROUP_ID);
    expect(s.symbols).toEqual([...DEFAULT_WATCHLIST]);
  });

  it("removeGroup refuse de supprimer le dernier onglet", () => {
    watchlistStore.getState().removeGroup(PRINCIPAL_GROUP_ID);
    expect(watchlistStore.getState().groups).toHaveLength(1);
  });

  it("removeGroup purge les sources devenues orphelines", () => {
    watchlistStore.getState().addGroup("Alt"); // actif
    watchlistStore.getState().add("XRPUSDT", "mexc");
    const altId = watchlistStore.getState().activeGroupId;
    watchlistStore.getState().removeGroup(altId);
    // XRPUSDT ne figure plus dans aucun groupe → sa source explicite est purgée.
    expect(watchlistStore.getState().sources["XRPUSDT"]).toBeUndefined();
  });
});
