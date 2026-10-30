/**
 * Titre des options d'alerte Funding, CVD S/P et Cascade liq désactivées, et refus à la soumission
 * (spec §5.2, §6.3). Sur un graphe Twelve Data, les perps cotés USD1 ou U (BTCUSD1, BTCU…) restent
 * exclus, résidu accepté : le texte dit d'où l'alerte est indisponible et n'affirme pas qu'il
 * n'existe pas de marché perp.
 */
import { describe, expect, it } from "vitest";
import type { ExchangeId } from "@axiom/types";
import { refusAlertePerp, titreOptionsPerp } from "./optionsPerp.util";

const DEPUIS_TWELVE_DATA = "Indisponible depuis un graphe Twelve Data : ouvrez la paire crypto pour créer cette alerte.";

describe("titre des options d'alerte perp désactivées", () => {
  it.each<[ExchangeId, string]>([
    ["twelvedata", "BTCUSD1"],
    ["twelvedata", "BTCU"],
    ["twelvedata", "SPY"],
    ["twelvedata", "IBM"],
    ["twelvedata", "EUR/USD"],
  ])("graphe Twelve Data, cible %s:%s → indisponible depuis ce graphe, sans « Pas de marché perp »", (exchange, symbol) => {
    const titre = titreOptionsPerp(exchange, symbol);
    expect(titre).toBe(DEPUIS_TWELVE_DATA);
    expect(titre).not.toContain("Pas de marché perp");
  });

  it.each<[ExchangeId, string]>([
    ["synthetic", "STABLE.D"],
    ["synthetic", "TOTAL3"],
    ["binance", "SPY"],
  ])("ailleurs, cible sans perp %s:%s → « Pas de marché perp pour … »", (exchange, symbol) => {
    expect(titreOptionsPerp(exchange, symbol)).toBe(
      `Pas de marché perp pour ${symbol} : alertes Funding, CVD S/P et Cascade liq indisponibles.`,
    );
  });

  it.each<[ExchangeId, string]>([
    ["twelvedata", "BTCUSDT"],
    ["binance", "BTCUSDT"],
    ["synthetic", "BTCUSD1"],
    ["hyperliquid", "HYPE-PERP"],
  ])("cible perp %s:%s → aucun titre, options permises", (exchange, symbol) => {
    expect(titreOptionsPerp(exchange, symbol)).toBeNull();
  });
});

// Contrôle défensif de la soumission et de « Créer l'alerte composée » : le type choisi (ou une
// sous-condition) survit à un changement de graphe, l'option désactivée ne suffit pas. Même texte
// que le titre de l'option.
describe("refus à la création — types × source du graphe × symbole", () => {
  const raisonStable = "Pas de marché perp pour STABLE.D : alertes Funding, CVD S/P et Cascade liq indisponibles.";
  it.each<[string[], ExchangeId, string, string | null]>([
    [["funding-extreme"], "synthetic", "STABLE.D", raisonStable],
    [["prix-croise", "liq-cascade"], "synthetic", "STABLE.D", raisonStable],
    [["liq-cascade"], "binance", "SPY", "Pas de marché perp pour SPY : alertes Funding, CVD S/P et Cascade liq indisponibles."],
    // Graphe Twelve Data : le texte du titre, sans « Pas de marché perp » (composée Prix ⋀ Funding
    // sur IBM, graphe passé sur SPY : le parcours de l'e2e).
    [["cvd-spot-perp-div"], "twelvedata", "SPY", DEPUIS_TWELVE_DATA],
    [["prix-croise", "funding-extreme"], "twelvedata", "IBM", DEPUIS_TWELVE_DATA],
    // Aucun type perp : rien à refuser, même sur une série.
    [["prix-croise", "variation-pct"], "synthetic", "STABLE.D", null],
    [["prix-croise"], "twelvedata", "IBM", null],
    [["funding-extreme"], "binance", "BTCUSDT", null],
    // Perp saisi sur un graphe série ou Twelve Data : il vise son marché.
    [["funding-extreme", "prix-croise"], "synthetic", "BTCUSDT", null],
    [["funding-extreme"], "twelvedata", "BTCUSDT", null],
  ])("%j sur %s:%s", (types, exchange, symbol, attendu) => {
    expect(refusAlertePerp(types, exchange, symbol)).toBe(attendu);
  });
});
