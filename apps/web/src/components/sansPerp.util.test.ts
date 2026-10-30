/**
 * Raisons affichées par les vues adossées à un marché perp quand le graphe n'en a pas : options
 * d'alerte désactivées (Funding, CVD S/P, Cascade liq) et message de la fenêtre LIQ. Le rendu
 * réel (attribut `disabled`, message visible) est vérifié par e2e/fuites-series-synthetiques.
 */
import { describe, expect, it } from "vitest";
import type { ExchangeId } from "@axiom/types";
import { raisonAlertesSansPerp, raisonLiqSansPerp, TYPES_ALERTE_PERP } from "./sansPerp.util";

const SANS_PERP: Array<[ExchangeId, string]> = [
  ["synthetic", "STABLE.D"],
  ["synthetic", "TOTAL3"],
  ["synthetic", "binance:BTCUSDT|/|binance:ETHUSDT"],
  ["twelvedata", "SPY"],
  ["twelvedata", "EUR/USD"],
  // Symbole saisi dans le champ de l'alerte sur un graphe Binance.
  ["binance", "STABLE.D"],
  ["binance", "SPY"],
];
const PERPS: Array<[ExchangeId, string]> = [
  ["binance", "BTCUSDT"],
  ["bybit", "SUSDT"],
  ["hyperliquid", "HYPE-PERP"],
  ["binance", "BROCCOLI714USDT"],
  // Cotations USD1 et U, inconnues de QUOTE_ASSETS : de vrais perps Binance.
  ["binance", "BTCUSD1"],
  ["binance", "BTCU"],
];

describe("alertes adossées à un perp", () => {
  it("les trois types perp, et eux seuls", () => {
    expect([...TYPES_ALERTE_PERP].sort()).toEqual(["cvd-spot-perp-div", "funding-extreme", "liq-cascade"]);
  });

  it.each(SANS_PERP)("%s:%s → refus explicite (option désactivée, soumission refusée)", (exchange, symbol) => {
    expect(raisonAlertesSansPerp(exchange, symbol)).toBe(
      `Pas de marché perp pour ${symbol} : alertes Funding, CVD S/P et Cascade liq indisponibles.`,
    );
  });

  it.each(PERPS)("%s:%s → permis", (exchange, symbol) => {
    expect(raisonAlertesSansPerp(exchange, symbol)).toBeNull();
  });

  // Perp saisi dans le champ de l'alerte sur un graphe série ou Twelve Data : il vise son marché.
  it.each<[ExchangeId, string]>([
    ["synthetic", "BTCUSDT"],
    ["twelvedata", "SOLUSDT"],
    // Cotations USD1 et U saisies sur une série : lues comme sur un graphe crypto.
    ["synthetic", "BTCUSD1"],
    ["synthetic", "ETHU"],
  ])("%s:%s (saisi) → permis", (exchange, symbol) => {
    expect(raisonAlertesSansPerp(exchange, symbol)).toBeNull();
  });
});

describe("fenêtre LIQ — message à la place de l'attente sans fin", () => {
  it.each(SANS_PERP)("%s:%s → message", (exchange, symbol) => {
    expect(raisonLiqSansPerp(exchange, symbol)).toBe("Pas de marché perp pour cette série : liquidations indisponibles.");
  });

  it.each(PERPS)("%s:%s → aucun (le flux est attendu)", (exchange, symbol) => {
    expect(raisonLiqSansPerp(exchange, symbol)).toBeNull();
  });
});
