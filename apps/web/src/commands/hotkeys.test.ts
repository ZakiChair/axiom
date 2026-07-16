/**
 * Tests des helpers PURS de raccourcis in-situ (`raccourciPour`, `raccourciTimeframe`)
 * dérivés de RACCOURCIS_AIDE. hotkeys.ts tire des modules à effet de bord non évaluables
 * hors navigateur (store/theme pose [data-theme] ; registry → chart/drawing charge
 * klinecharts ; chart/liquidationMarkers idem). On les neutralise via vi.mock — même
 * approche que registry.test.ts — pour importer le module en environnement Node.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../store/theme", () => ({
  THEMES: ["dark", "bloomberg", "matrix", "cute", "aurora"] as const,
  themeStore: { getState: () => ({ theme: "dark", setTheme: () => {} }) },
}));
vi.mock("./registry", () => ({
  paletteStore: { getState: () => ({ ouvert: false, ouvrir: () => {} }) },
}));
vi.mock("../chart/liquidationMarkers", () => ({
  liqMarksStore: { getState: () => ({ basculer: () => {} }) },
}));

import { raccourciPour, raccourciTimeframe } from "./hotkeys";

describe("raccourciPour", () => {
  it("mappe les libellés de boutons vers leur touche (dérivé de RACCOURCIS_AIDE)", () => {
    expect(raccourciPour("Orderflow")).toBe("O");
    expect(raccourciPour("Profil Vol")).toBe("V");
    expect(raccourciPour("Revenus")).toBe("R");
    expect(raccourciPour("Liq")).toBe("L");
    expect(raccourciPour("Plein écran")).toBe("F");
    expect(raccourciPour("Thème")).toBe("T");
  });

  it("renvoie null pour un libellé inconnu", () => {
    expect(raccourciPour("Produits dérivés")).toBeNull();
    expect(raccourciPour("")).toBeNull();
  });
});

describe("raccourciTimeframe", () => {
  it("associe les 9 premiers timeframes aux chiffres 1-9", () => {
    expect(raccourciTimeframe("1m")).toBe("1");
    expect(raccourciTimeframe("5m")).toBe("2");
    expect(raccourciTimeframe("1h")).toBe("4");
    expect(raccourciTimeframe("3M")).toBe("9");
  });

  it("renvoie null pour les timeframes sans chiffre (au-delà de 9)", () => {
    expect(raccourciTimeframe("6M")).toBeNull();
    expect(raccourciTimeframe("12M")).toBeNull();
  });

  it("renvoie null pour un timeframe inconnu", () => {
    expect(raccourciTimeframe("42x")).toBeNull();
  });
});
