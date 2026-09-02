/**
 * Tests des helpers PURES de la palette : `devraitAvoirNavProeminent` (la navigation
 * doit-elle prendre la tête ?) et `construireItemsRecherche` (liste affichée pour une
 * requête non vide, navigation comprise).
 */
import { describe, it, expect, vi } from "vitest";

// Mocks nécessaires pour importer registry (via CommandPalette).
vi.mock("../store/theme", () => ({
  THEMES: ["dark", "bloomberg", "matrix", "cute", "aurora"] as const,
  themeStore: {
    getState: () => ({ theme: "dark", setTheme: () => {} }),
    subscribe: () => () => {},
  },
}));
vi.mock("../chart/drawing", () => ({
  exportChartImage: () => {},
  clearAllOverlays: () => {},
  getActiveChart: () => null,
  setFocusChart: () => {},
}));
vi.mock("klinecharts", () => ({
  registerOverlay: () => {},
  ActionType: {},
  DomPosition: {},
}));

import { construireItemsRecherche, devraitAvoirNavProeminent } from "./CommandPalette";
import { construireRegistre, rechercher, type Commande } from "../commands/registry";

describe("devraitAvoirNavProeminent — navigation proéminente en tête", () => {
  const registre: Commande[] = [
    {
      id: "seag",
      mnemonique: "SEAG",
      libelle: "Saisonnalité",
      categorie: "panneau",
      motsCles: ["saisonnalité", "heatmap"],
      action: () => {},
    },
    {
      id: "ind:rsi",
      mnemonique: "RSI",
      libelle: "RSI — activer",
      categorie: "indicateur",
      motsCles: ["momentum"],
      action: () => {},
    },
  ];

  it("retourne false quand nav est null", () => {
    expect(devraitAvoirNavProeminent("SOL 4H", null, registre)).toBe(false);
  });

  it("retourne true quand la saisie contient un timeframe explicite", () => {
    const nav = { timeframe: "4h" as const };
    expect(devraitAvoirNavProeminent("4H", nav, registre)).toBe(true);
  });

  it("retourne true quand la saisie contient une source explicite", () => {
    const nav = { source: "binance" as const };
    expect(devraitAvoirNavProeminent("BINANCE", nav, registre)).toBe(true);
  });

  it("retourne true quand la saisie a plusieurs tokens", () => {
    const nav = { symbol: "SOLUSDT", timeframe: "4h" as const };
    expect(devraitAvoirNavProeminent("SOL 4H", nav, registre)).toBe(true);
  });

  it("retourne true quand aucune commande ne matche (utilisateur navigue)", () => {
    const nav = { symbol: "BTCUSDT" };
    expect(devraitAvoirNavProeminent("BTCUSDT", nav, registre)).toBe(true);
  });

  it('retourne false quand « saisonnalite » matche « Saisonnalité » (accentuation normalisée)', () => {
    const nav = { symbol: "SAISONNALITE" };
    // La commande SEAG (libelle: "Saisonnalité") matche "saisonnalite" après normalisation
    // → nav n'est pas proéminente, la commande prend la tête
    expect(devraitAvoirNavProeminent("saisonnalite", nav, registre)).toBe(false);
  });

  it('retourne true quand « BTCUSDT » ne matche aucune commande', () => {
    const nav = { symbol: "BTCUSDT" };
    expect(devraitAvoirNavProeminent("BTCUSDT", nav, registre)).toBe(true);
  });

  it('retourne false quand « RSI » matche la commande RSI', () => {
    const nav = { symbol: "RSI" };
    expect(devraitAvoirNavProeminent("RSI", nav, registre)).toBe(false);
  });
});

/**
 * Non-régression du commit a033f20 : la commande de navigation ne doit JAMAIS
 * disparaître de la liste. Le registre RÉEL (208 commandes) est indispensable ici :
 * la recherche floue par sous-séquence fait matcher presque tout ticker de 3-4 lettres
 * (ETH → 6 résultats, tête HURST), donc `devraitAvoirNavProeminent` est faux et
 * l'ancienne implémentation OMETTAIT l'item de navigation — taper « ETH » puis Entrée
 * basculait un indicateur au lieu de changer de paire.
 */
describe("construireItemsRecherche — la navigation n'est jamais supprimée", () => {
  const reel = construireRegistre();

  it("« ETH » : nav rétrogradée en fin de liste, jamais absente", () => {
    // Prérequis du cas : ETH matche bien des commandes (sinon la nav serait proéminente).
    expect(rechercher(reel, "ETH").length).toBeGreaterThan(0);
    const items = construireItemsRecherche("ETH", reel);
    expect(items.some((it) => it.cmd.id === "nav")).toBe(true);
    expect(items[items.length - 1]?.cmd.id).toBe("nav");
    expect(items[0]?.cmd.id).not.toBe("nav");
  });

  it("« RSI » et « DES » : la commande garde la tête, la nav reste en queue", () => {
    for (const q of ["RSI", "DES"]) {
      const items = construireItemsRecherche(q, reel);
      expect(items[0]?.cmd.id).not.toBe("nav");
      expect(items[items.length - 1]?.cmd.id).toBe("nav");
    }
  });

  it("« SOL 4H » : la navigation explicite garde la tête", () => {
    const items = construireItemsRecherche("SOL 4H", reel);
    expect(items[0]?.cmd.id).toBe("nav");
    expect(items.filter((it) => it.cmd.id === "nav").length).toBe(1);
  });
});
