import { describe, expect, it } from "vitest";
import { composerRatioLibre, optionsDiviseur, presentationOption, referenceFixe, symboleRatioLibre, type OptionDiviseur } from "./choixDiviseur";
import type { MarketCandidate, MarketCatalog } from "./marketRouting";
import type { ExchangeId } from "@axiom/types";

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

describe("« Autre actif… » : ligne affichée d'une option (presentationOption)", () => {
  /** Option telle que la compose le sélecteur : candidat du catalogue composé contre la base. */
  const option = (base: { symbol: string; exchange: ExchangeId }, candidat: MarketCandidate): OptionDiviseur =>
    ({ candidat, resultat: symboleRatioLibre(base.symbol, base.exchange, { exchange: candidat.exchange, symbol: candidat.symbol }) });
  const ETHUSDT: MarketCandidate = { exchange: "binance", symbol: "ETHUSDT", kind: "spot" };

  it("fixe d'abord hors Binance : la jambe posée sur la place du numérateur, signalée comme dénominateur du menu", () => {
    const kraken = presentationOption(option({ symbol: "BTCEUR", exchange: "kraken" }, ETHUSDT));
    expect(kraken).toMatchObject({ symbole: "ETHUSD", source: "Kraken" });
    expect(kraken.detail).toContain("÷ETH");
    expect(presentationOption(option({ symbol: "BTC-PERP", exchange: "hyperliquid" }, ETHUSDT))).toMatchObject({ symbole: "ETH-PERP", source: "Hyperliquid" });
    // Perp choisi, spot posé : la ligne nomme l'instrument réellement divisé, sans « Perp · ».
    expect(presentationOption(option(BASE, { exchange: "hyperliquid", symbol: "ETH-PERP", kind: "perp" }))).toMatchObject({ symbole: "ETHUSDT", source: "Binance" });
  });

  it("ligne libre inchangée : symbole du candidat, son libellé et sa place (« Perp · » pour un perp)", () => {
    expect(presentationOption(option(BASE, { exchange: "twelvedata", symbol: "AAPL", kind: "tradfi", label: "Apple" }))).toEqual({ symbole: "AAPL", detail: "Apple", source: "Twelve Data" });
    expect(presentationOption(option(BASE, { exchange: "hyperliquid", symbol: "HYPE-PERP", kind: "perp" }))).toEqual({ symbole: "HYPE-PERP", source: "Perp · Hyperliquid" });
  });
});

describe("« Autre actif… » : composition libre et messages de refus (hors chargement initial)", () => {
  it("composerRatioLibre : compositions libres", () => {
    expect(composerRatioLibre("BTCUSD", "coinbase", { exchange: "binance", symbol: "BTCUSDT" })).toEqual({ symbole: "coinbase:BTCUSD|/|binance:BTCUSDT", denom: null });
    expect(composerRatioLibre("ETHBTC", "binance", { exchange: "binance", symbol: "ADABTC" })).toEqual({ symbole: "binance:ETHBTC|/|binance:ADABTC", denom: null });
    expect(composerRatioLibre("BTCUSDT", "binance", { exchange: "twelvedata", symbol: "AAPL" })).toEqual({ symbole: "binance:BTCUSDT|/|twelvedata:AAPL", denom: null });
    expect(composerRatioLibre("TOTAL", "synthetic", { exchange: "twelvedata", symbol: "AAPL" })).toEqual({ symbole: "mcap:TOTAL|/|twelvedata:AAPL", denom: null });
    expect(composerRatioLibre("BTCUSDT", "binance", { exchange: "synthetic", symbol: "TOTAL2" })).toEqual({ symbole: "binance:BTCUSDT|/|mcap:TOTAL2", denom: null });
  });

  it("composerRatioLibre : refus", () => {
    expect(composerRatioLibre("ETHUSDT", "binance", { exchange: "binance", symbol: "ETHUSDT" })).toEqual({ refus: "Même actif que le graphique" });
    expect(composerRatioLibre("BTCUSDT", "binance", { exchange: "twelvedata", symbol: "USD/JPY" })).toEqual({ refus: "Devises différentes (USD contre JPY)" });
    expect(composerRatioLibre("BTCEUR", "kraken", { exchange: "twelvedata", symbol: "CPER" })).toEqual({ refus: "Devises différentes (EUR contre USD)" });
    expect(composerRatioLibre("BTCUSDT", "binance", { exchange: "twelvedata", symbol: "RY:TSX" })).toEqual({ refus: "Devise de cotation inconnue" });
    expect(composerRatioLibre("BTCUSDT", "binance", { exchange: "synthetic", symbol: "STABLE.D" })).toEqual({ refus: "Série en % ou déjà composée : pas un diviseur" });
    expect(composerRatioLibre("binance:ETHUSDT|-|binance:BTCUSDT", "synthetic", { exchange: "twelvedata", symbol: "AAPL" })).toEqual({ refus: "Graphique composé : revenez à un actif simple" });
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
