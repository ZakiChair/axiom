/**
 * Tests du store watchlist — suivi de la SOURCE d'origine par symbole (roadmap 0.4b).
 * La map `sources` est creuse : seules les entrées à source explicite y figurent.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_WATCHLIST, watchlistStore } from "./watchlist";

beforeEach(() => {
  watchlistStore.setState({ symbols: [...DEFAULT_WATCHLIST], sources: {} });
});

describe("watchlistStore", () => {
  it("add sans source n'inscrit rien dans la map (routage par inférence)", () => {
    watchlistStore.getState().add("bnbusdt");
    const s = watchlistStore.getState();
    expect(s.symbols).toContain("BNBUSDT"); // normalisé en majuscules
    expect(s.sources["BNBUSDT"]).toBeUndefined(); // pas de source explicite
  });

  it("add avec source fige la provenance sous la clé majuscule", () => {
    watchlistStore.getState().add("btcusd", "kraken");
    expect(watchlistStore.getState().sources["BTCUSD"]).toBe("kraken");
  });

  it("add ignore un doublon (n'écrase pas la source déjà posée)", () => {
    watchlistStore.getState().add("BTCUSD", "kraken");
    watchlistStore.getState().add("BTCUSD", "coinbase"); // doublon → ignoré
    const s = watchlistStore.getState();
    expect(s.symbols.filter((x) => x === "BTCUSD")).toHaveLength(1);
    expect(s.sources["BTCUSD"]).toBe("kraken"); // inchangé
  });

  it("remove purge le symbole ET sa source", () => {
    watchlistStore.getState().add("BTCUSD", "kraken");
    watchlistStore.getState().remove("BTCUSD");
    const s = watchlistStore.getState();
    expect(s.symbols).not.toContain("BTCUSD");
    expect(s.sources["BTCUSD"]).toBeUndefined();
  });

  it("setAll remplace la liste et réinitialise les sources par défaut (map vide)", () => {
    watchlistStore.getState().add("BTCUSD", "kraken");
    watchlistStore.getState().setAll(["ETHUSDT", "SOLUSDT"]);
    const s = watchlistStore.getState();
    expect(s.symbols).toEqual(["ETHUSDT", "SOLUSDT"]);
    expect(s.sources).toEqual({}); // sources non fournies → réinitialisées
  });
});
