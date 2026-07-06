/**
 * Tests de la fonction PURE isBuilderQuery (PairSearch). Le rendu React n'est pas testé
 * (pas d'environnement DOM ici) : on couvre uniquement l'heuristique de bascule vers le
 * constructeur de séries synthétiques — seule porteuse de régression silencieuse.
 */
import { describe, expect, it } from "vitest";
import { isBuilderQuery } from "./PairSearch";

describe("isBuilderQuery", () => {
  it("détecte une saisie de symbole synthétique en construction (contient / ou -)", () => {
    expect(isBuilderQuery("BTC/USD", [])).toBe(true);
    expect(isBuilderQuery("BTC-PERP", [])).toBe(true);
  });

  it("ignore une saisie sans / ni - (recherche catalogue normale)", () => {
    expect(isBuilderQuery("BTCUSDT", ["BTCUSDT"])).toBe(false);
  });

  it("exception catalogue exact : un ticker existant contenant / ne déclenche pas le constructeur", () => {
    // EUR/USD est un ticker tradfi réel du catalogue Twelve Data (cf. data/pairs.ts) —
    // taper ce ticker doit rester sur le chemin de sélection normal.
    expect(isBuilderQuery("EUR/USD", ["EUR/USD", "GBP/USD"])).toBe(false);
  });

  it("un préfixe partiel d'un ticker à slash reste une saisie constructeur (pas de correspondance exacte)", () => {
    expect(isBuilderQuery("EUR/US", ["EUR/USD"])).toBe(true);
  });

  it("insensible à la casse et aux espaces, comme la normalisation du champ", () => {
    expect(isBuilderQuery("  eur/usd  ", ["EUR/USD"])).toBe(false);
  });

  it("chaîne vide : jamais une saisie constructeur", () => {
    expect(isBuilderQuery("", ["EUR/USD"])).toBe(false);
  });
});
