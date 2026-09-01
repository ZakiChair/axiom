/**
 * Tests du helper `devraitAvoirNavProeminent` — logique de décision
 * pour déterminer si la navigation doit être proéminente dans la palette.
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

import { devraitAvoirNavProeminent } from "./CommandPalette";
import type { Commande } from "../commands/registry";

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
