import { describe, expect, it } from "vitest";
import type { CoinTile } from "../data/marketOverview";
import { classerPerformances, estStablecoin, resumePerformances, valeurPeriode } from "./classementPerformances.util";

/** Tuile de fixture, rangée par capitalisation décroissante comme parseMarkets. */
function tuile(symbol: string, mcapUsd: number, p: Partial<CoinTile> = {}): CoinTile {
  return {
    id: symbol.toLowerCase(), symbol, name: symbol, mcapUsd, price: 10, volume24hUsd: 1e6, observeLe: null,
    changePct24h: 0, changePct7j: 0, changePct30j: 0, changePct1h: 0, ...p,
  };
}

const MARCHE: CoinTile[] = [
  tuile("BTC", 1_300e9, { changePct24h: 1.2, changePct1h: 0.1, changePct7j: 4 }),
  tuile("ETH", 400e9, { changePct24h: -2.5, changePct1h: -0.4, changePct7j: 9 }),
  tuile("USDT", 180e9, { price: 1.0002, changePct24h: 0.01, changePct1h: 0, changePct7j: 0.02 }),
  tuile("HYPE", 30e9, { changePct24h: 12.4, changePct1h: 1.5, changePct7j: null }),
  tuile("PEPE", 5e9, { changePct24h: -8.1, changePct1h: 2.2, changePct7j: -3 }),
];

describe("classement des performances (façon accueil CoinGlass)", () => {
  it("24 h, hausses : du plus fort gain au plus faible, rang de capitalisation conservé", () => {
    const lignes = classerPerformances(MARCHE, { periode: "24h", sens: "hausses", univers: 250, sansStables: false });
    expect(lignes.map((l) => l.symbol)).toEqual(["HYPE", "BTC", "USDT", "ETH", "PEPE"]);
    expect(lignes.map((l) => l.rang)).toEqual([1, 2, 3, 4, 5]);
    expect(lignes[0]).toMatchObject({ symbol: "HYPE", rangCap: 4 });
  });

  it("baisses : ordre inverse ; les stablecoins sont retirés par défaut", () => {
    const lignes = classerPerformances(MARCHE, { periode: "24h", sens: "baisses", univers: 250, sansStables: true });
    expect(lignes.map((l) => l.symbol)).toEqual(["PEPE", "ETH", "BTC", "HYPE"]);
  });

  it("période 7 j : un actif sans variation connue sort du classement (jamais un 0 inventé)", () => {
    const lignes = classerPerformances(MARCHE, { periode: "7j", sens: "hausses", univers: 250, sansStables: true });
    expect(lignes.map((l) => l.symbol)).toEqual(["ETH", "BTC", "PEPE"]);
  });

  it("univers : seuls les N premiers par capitalisation concourent", () => {
    const lignes = classerPerformances(MARCHE, { periode: "1h", sens: "hausses", univers: 2, sansStables: true });
    expect(lignes.map((l) => l.symbol)).toEqual(["BTC", "ETH"]);
  });

  it("valeur d'une période et résumé hausses / baisses / médiane", () => {
    expect(valeurPeriode(MARCHE[3]!, "1h")).toBe(1.5);
    expect(valeurPeriode(MARCHE[3]!, "7j")).toBeNull();
    const lignes = classerPerformances(MARCHE, { periode: "24h", sens: "hausses", univers: 250, sansStables: true });
    expect(resumePerformances(lignes, "24h")).toEqual({ hausses: 2, baisses: 2, mediane: (1.2 + -2.5) / 2 });
    expect(resumePerformances([], "24h")).toEqual({ hausses: 0, baisses: 0, mediane: null });
  });

  it("stablecoins : liste connue, ou prix ancré à 1 $ sans mouvement", () => {
    expect(estStablecoin(tuile("USDC", 1, { price: 1 }))).toBe(true);
    expect(estStablecoin(tuile("NEWUSD", 1, { price: 0.9995, changePct24h: 0.02, changePct7j: 0.05 }))).toBe(true);
    // Un actif à 1 $ qui bouge n'est pas un stablecoin.
    expect(estStablecoin(tuile("XRP", 1, { price: 1.01, changePct24h: 3.2, changePct7j: 6 }))).toBe(false);
    expect(estStablecoin(tuile("PAXG", 1, { price: 2_400 }))).toBe(false);
  });
});
