/**
 * Prédicat partagé « aucun marché perp » (lot fuites-séries-synthétiques, spec §1) : garde RÉSEAU
 * des sites perp (alertes funding/CVD/cascade, flux de liquidations, LIQHL, LIQEST, liquidations par
 * bougie). Matrice obligatoire : les séries et la TradFi sont exclues, aucun vrai perp ne l'est — en
 * particulier ceux que les bornes de `basePerp`/`actifPerpDe` rejetteraient (SUSDT, BROCCOLI714USDT,
 * 1000000PEIPEIUSDT…).
 */
import { describe, expect, it } from "vitest";
import type { ExchangeId } from "@axiom/types";
import { grapheSansPerp, sansMarchePerp, sansMarchePerpCible } from "./market";

const COMPOSITE = "binance:BTCUSDT|/|binance:ETHUSDT";

describe("sansMarchePerp — séries et TradFi : aucun marché perp", () => {
  const sansPerp: Array<[ExchangeId, string]> = [
    ["synthetic", "TOTAL"],
    ["synthetic", "TOTAL2"],
    ["synthetic", "TOTAL3"],
    ["synthetic", "STABLE.D"],
    ["synthetic", COMPOSITE],
    ["twelvedata", "SPY"],
    ["twelvedata", "EUR/USD"],
    ["twelvedata", "AAPL"],
    ["twelvedata", "USDT.D"],
    ["twelvedata", "BRK.B"],
  ];
  it.each(sansPerp)("%s:%s → vrai", (exchange, symbol) => {
    expect(sansMarchePerp(exchange, symbol)).toBe(true);
  });

  // Symbole saisi (alerte) sur la source d'un graphe crypto : le symbole seul suffit à exclure.
  it.each(sansPerp.map(([, symbol]) => symbol))("binance:%s → vrai (symbole saisi sur un graphe crypto)", (symbol) => {
    expect(sansMarchePerp("binance", symbol)).toBe(true);
  });

  // API partagée : même verdict quelles que soient la casse et les espaces de la saisie.
  it.each(["total3", "Total2", " TOTAL3 ", "stable.d", " spy ", "eur/usd"])("binance:%j → vrai (casse et espaces ignorés)", (symbol) => {
    expect(sansMarchePerp("binance", symbol)).toBe(true);
  });

  it("toute paire posée sur synthetic ou twelvedata reste sans perp (source du graphe)", () => {
    expect(sansMarchePerp("synthetic", "BTCUSDT")).toBe(true);
    expect(sansMarchePerp("twelvedata", "BTCUSDT")).toBe(true);
  });

  // Forex à barre hors du catalogue curé (USD/SEK est dans DEVISES_FOREX, pas dans TWELVEDATA_SYMBOLS) :
  // sans le « / » du prédicat, une déf funding {binance, USD/SEK} sonderait fapi puis Coinalyze.
  it("forex à barre hors catalogue curé : binance:USD/SEK → vrai", () => {
    expect(sansMarchePerp("binance", "USD/SEK")).toBe(true);
  });

  it("le graphe courant : grapheSansPerp lit sa source et son symbole", () => {
    expect(grapheSansPerp({ exchange: "synthetic", symbol: "STABLE.D" })).toBe(true);
    expect(grapheSansPerp({ exchange: "binance", symbol: "SPY" })).toBe(true);
    expect(grapheSansPerp({ exchange: "binance", symbol: "BTCUSDT" })).toBe(false);
    expect(grapheSansPerp({ exchange: "hyperliquid", symbol: "HYPE-PERP" })).toBe(false);
  });
});

describe("sansMarchePerp — vrais marchés : jamais exclus", () => {
  const perps: Array<[ExchangeId, string]> = [
    ["binance", "BTCUSDT"],
    ["bybit", "BTCUSDT"],
    ["okx", "BTCUSDT"],
    ["binance", "HYPEUSDT"],
    ["hyperliquid", "HYPE-PERP"],
    ["hyperliquid", "kPEPE-PERP"],
    ["binance", "1000PEPEUSDT"],
    ["binance", "BTCUSDC"],
    ["binance", "BTCFDUSD"],
    // Bases d'un caractère ou de plus de 10 : rejetées par basePerp, de vrais perps pourtant.
    ["bybit", "SUSDT"],
    ["binance", "WUSDT"],
    ["binance", "TUSDT"],
    ["binance", "BROCCOLI714USDT"],
    ["binance", "1000000PEIPEIUSDT"],
    // Perps Binance USDⓈ-M cotés en USD1 ou en U, cotations que QUOTE_ASSETS ignore : le repli
    // « cotation inconnue → TradFi » de la saisie libre ne doit pas les exclure (revue du 29/10).
    ["binance", "BTCUSD1"],
    ["binance", "ETHUSD1"],
    ["binance", "BTCU"],
    ["binance", "ETHU"],
    // Perps linéaires USDC de Bybit (« …PERP », 60 au catalogue du 29/10), même repli.
    ["bybit", "BTCPERP"],
    // Formats réels des autres places (data/pairs.ts, data/symbol.ts) : Kraken XBT/XDG aliasés
    // et format WS à slash, Coinbase « BTC-USD » concaténé, MEXC dont les actions tokenisées.
    ["kraken", "BTCUSD"],
    ["kraken", "DOGEUSD"],
    ["kraken", "ETHEUR"],
    ["kraken", "XBT/USD"],
    // Paire crypto à barre (cotée en BTC) : la barre seule n'en fait pas du forex.
    ["kraken", "ETH/BTC"],
    ["coinbase", "BTCUSD"],
    ["coinbase", "ETHUSDC"],
    ["coinbase", "BTC-USD"],
    ["mexc", "BTCUSDT"],
    ["mexc", "AAPLXUSDT"],
    ["mexc", "TSLAONUSDT"],
  ];
  it.each(perps)("%s:%s → faux", (exchange, symbol) => {
    expect(sansMarchePerp(exchange, symbol)).toBe(false);
  });
});

// Cible d'une alerte : source du GRAPHE à la création, symbole SAISI. Un perp saisi sur un graphe
// série ou Twelve Data était sondé à c2f757d (le sondage ne lit que le symbole) et doit le rester.
describe("sansMarchePerpCible — cible d'alerte {source du graphe, symbole saisi}", () => {
  const sondees: Array<[ExchangeId, string]> = [
    ["synthetic", "BTCUSDT"],
    ["twelvedata", "SOLUSDT"],
    ["synthetic", "HYPE-PERP"],
    ["binance", "BTCUSD1"],
    ["bybit", "SUSDT"],
    // Perps Binance cotés USD1 ou U saisis sur une série (revue du 30/10) : lus comme sur un graphe
    // crypto, le repli « cotation inconnue → TradFi » du routage ne les exclut pas.
    ["synthetic", "BTCUSD1"],
    ["synthetic", "ETHUSD1"],
    ["synthetic", "SPCXUSD1"],
    ["synthetic", "BTCU"],
    ["synthetic", "ETHU"],
  ];
  it.each(sondees)("%s:%s → faux (le perp saisi vise son marché)", (source, symbol) => {
    expect(sansMarchePerpCible(source, symbol)).toBe(false);
  });

  const exclues: Array<[ExchangeId, string]> = [
    ["synthetic", "STABLE.D"],
    ["synthetic", "TOTAL3"],
    ["synthetic", COMPOSITE],
    ["twelvedata", "SPY"],
    ["twelvedata", "EUR/USD"],
    // Ticker libre, symbole propre d'un graphe Twelve Data : le routage le garde en TradFi.
    ["twelvedata", "IBM"],
    ["binance", "STABLE.D"],
    ["binance", "USDT.D"],
    ["binance", "SPY"],
    // TradFi reconnue saisie sur une série : toujours exclue.
    ["synthetic", "SPY"],
    ["synthetic", "EUR/USD"],
    ["synthetic", "BRK.B"],
    ["synthetic", "USDT.D"],
    // Forex à barre hors catalogue curé saisi sur une série.
    ["synthetic", "EUR/CHF"],
  ];
  it.each(exclues)("%s:%s → vrai", (source, symbol) => {
    expect(sansMarchePerpCible(source, symbol)).toBe(true);
  });
});
