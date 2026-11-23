import { describe, expect, it } from "vitest";
import { optionsDiviseur, referenceFixe, symboleRatioLibre } from "./choixDiviseur";
import type { MarketCatalog } from "./marketRouting";

/** Catalogue fixe, toutes sources : crypto (Binance), Twelve Data (ETF, action, forex) et série autonome. */
const CATALOGUE: MarketCatalog = {
  instruments: [
    { exchange: "binance", symbol: "ETHUSDT", kind: "spot" },
    { exchange: "binance", symbol: "BTCUSDT", kind: "spot" },
    { exchange: "twelvedata", symbol: "CPER", kind: "tradfi" },
    { exchange: "twelvedata", symbol: "AAPL", kind: "tradfi" },
    { exchange: "twelvedata", symbol: "USD/JPY", kind: "tradfi" },
    { exchange: "synthetic", symbol: "STABLE.D", kind: "synthetic" },
  ],
  unavailableSources: [],
};
const BASE = { symbol: "BTCUSDT", exchange: "binance" as const };

describe("« Autre actif… » : options du sélecteur (optionsDiviseur)", () => {
  it("requête vide ou blanche : aucune option", () => {
    expect(optionsDiviseur(CATALOGUE, "", BASE, "1d")).toEqual([]);
    expect(optionsDiviseur(CATALOGUE, "   ", BASE, "1d")).toEqual([]);
  });

  it("chaque résultat de la recherche commune est composé contre la base, fixe d'abord", () => {
    expect(optionsDiviseur(CATALOGUE, "CPER", BASE, "1d")[0]).toMatchObject({
      candidat: { symbol: "CPER" },
      resultat: { symbole: "binance:BTCUSDT|/|twelvedata:CPER", denom: "CUIVRE" },
    });
    expect(optionsDiviseur(CATALOGUE, "ETHUSDT", BASE, "1d")[0]).toMatchObject({
      candidat: { exchange: "binance", symbol: "ETHUSDT" },
      resultat: { symbole: "binance:BTCUSDT|/|binance:ETHUSDT", denom: "ETH" },
    });
    expect(optionsDiviseur(CATALOGUE, "AAPL", BASE, "1d")[0]).toMatchObject({
      candidat: { symbol: "AAPL" },
      resultat: { symbole: "binance:BTCUSDT|/|twelvedata:AAPL", denom: null },
    });
  });

  it("un résultat incompatible porte sa raison de refus", () => {
    expect(optionsDiviseur(CATALOGUE, "USD/JPY", BASE, "1d")[0]).toMatchObject({
      candidat: { symbol: "USD/JPY" },
      resultat: { refus: "Devises différentes (USD contre JPY)" },
    });
    expect(optionsDiviseur(CATALOGUE, "STABLE.D", BASE, "1d")[0]).toMatchObject({
      candidat: { symbol: "STABLE.D" },
      resultat: { refus: "Série en % ou déjà composée : pas un diviseur" },
    });
    expect(optionsDiviseur(CATALOGUE, "BTCUSDT", BASE, "1d")[0]).toMatchObject({
      candidat: { symbol: "BTCUSDT" },
      resultat: { refus: "Même actif que le graphique" },
    });
  });

  it("la casse de la saisie ne change rien : la composition porte le symbole du catalogue", () => {
    expect(optionsDiviseur(CATALOGUE, "cper", BASE, "1d")).toEqual(optionsDiviseur(CATALOGUE, "CPER", BASE, "1d"));
  });

  it("limite : nombre maximal de résultats", () => {
    expect(optionsDiviseur(CATALOGUE, "USD", BASE, "1d").length).toBeGreaterThan(1);
    expect(optionsDiviseur(CATALOGUE, "USD", BASE, "1d", 1)).toHaveLength(1);
  });
});

describe("« Autre actif… » : choix du diviseur (lot 2)", () => {
  it("referenceFixe : id dont la jambe est la référence de sa place", () => {
    expect(referenceFixe({ exchange: "binance", symbol: "ETHUSDT" })).toBe("ETH");
    expect(referenceFixe({ exchange: "twelvedata", symbol: "CPER" })).toBe("CUIVRE");
    expect(referenceFixe({ exchange: "binance", symbol: "ADAUSDT" })).toBeNull();
  });

  it("fixe d'abord, par référence, sur la place du numérateur", () => {
    expect(symboleRatioLibre("BTCUSDT", "binance", { exchange: "binance", symbol: "ETHUSDT" })).toEqual({ symbole: "binance:BTCUSDT|/|binance:ETHUSDT", denom: "ETH" });
    expect(symboleRatioLibre("HYPEUSDT", "bybit", { exchange: "binance", symbol: "ETHUSDT" })).toEqual({ symbole: "bybit:HYPEUSDT|/|bybit:ETHUSDT", denom: "ETH" });
    expect(symboleRatioLibre("SOLUSD", "kraken", { exchange: "binance", symbol: "ETHUSDT" })).toEqual({ symbole: "kraken:SOLUSD|/|kraken:ETHUSD", denom: "ETH" });
    expect(symboleRatioLibre("BTCUSDT", "binance", { exchange: "twelvedata", symbol: "CPER" })).toEqual({ symbole: "binance:BTCUSDT|/|twelvedata:CPER", denom: "CUIVRE" });
    expect(symboleRatioLibre("BTCUSDT", "binance", { exchange: "twelvedata", symbol: "SPY" })).toEqual({ symbole: "binance:BTCUSDT|/|twelvedata:SPY", denom: "SP500" });
    expect(symboleRatioLibre("ETHBTC", "binance", { exchange: "binance", symbol: "SOLUSDT" })).toEqual({ symbole: "binance:ETHBTC|/|binance:SOLUSDT", denom: "SOL" });
  });

  it("libres", () => {
    expect(symboleRatioLibre("BTCUSD", "coinbase", { exchange: "binance", symbol: "BTCUSDT" })).toEqual({ symbole: "coinbase:BTCUSD|/|binance:BTCUSDT", denom: null });
    expect(symboleRatioLibre("ETHBTC", "binance", { exchange: "binance", symbol: "ADABTC" })).toEqual({ symbole: "binance:ETHBTC|/|binance:ADABTC", denom: null });
    expect(symboleRatioLibre("BTCUSDT", "binance", { exchange: "twelvedata", symbol: "AAPL" })).toEqual({ symbole: "binance:BTCUSDT|/|twelvedata:AAPL", denom: null });
    expect(symboleRatioLibre("TOTAL", "synthetic", { exchange: "twelvedata", symbol: "AAPL" })).toEqual({ symbole: "mcap:TOTAL|/|twelvedata:AAPL", denom: null });
    expect(symboleRatioLibre("BTCUSDT", "binance", { exchange: "synthetic", symbol: "TOTAL2" })).toEqual({ symbole: "binance:BTCUSDT|/|mcap:TOTAL2", denom: null });
  });

  it("refus", () => {
    expect(symboleRatioLibre("ETHUSDT", "binance", { exchange: "binance", symbol: "ETHUSDT" })).toEqual({ refus: "Même actif que le graphique" });
    expect(symboleRatioLibre("BTCUSDT", "binance", { exchange: "twelvedata", symbol: "USD/JPY" })).toEqual({ refus: "Devises différentes (USD contre JPY)" });
    expect(symboleRatioLibre("BTCEUR", "kraken", { exchange: "twelvedata", symbol: "CPER" })).toEqual({ refus: "Devises différentes (EUR contre USD)" });
    expect(symboleRatioLibre("BTCUSDT", "binance", { exchange: "twelvedata", symbol: "RY:TSX" })).toEqual({ refus: "Devise de cotation inconnue" });
    expect(symboleRatioLibre("BTCUSDT", "binance", { exchange: "synthetic", symbol: "STABLE.D" })).toEqual({ refus: "Série en % ou déjà composée : pas un diviseur" });
    expect(symboleRatioLibre("binance:ETHUSDT|-|binance:BTCUSDT", "synthetic", { exchange: "twelvedata", symbol: "AAPL" })).toEqual({ refus: "Graphique composé : revenez à un actif simple" });
  });
});
