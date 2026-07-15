/**
 * Tests des fonctions PURES de la grille 2D de liquidations (bougie × bucket de prix).
 * Couvre : agrégation de deux liqs d'une même bougie/bucket en une cellule, séparation
 * long/short, intensité log-normalisée (croissante, 0→0, max→1), profil latéral par prix
 * sommé sur toutes les bougies, et les cas null (aucune bougie visible / aucune cellule).
 */
import { describe, it, expect, vi } from "vitest";

// liquidationHeat importe ./liquidationMarkers, qui appelle registerOverlay + importe
// ./drawing (klinecharts) et ../store/theme et s'abonne à des flux à l'import : on stub le
// tout pour importer les fonctions PURES en environnement Node (même stubs que
// liquidationMarkers.test.ts).
vi.mock("klinecharts", () => ({ registerOverlay: () => {} }));
vi.mock("./drawing", () => ({ getActiveChart: () => null }));
vi.mock("../store/theme", () => ({
  themeStore: { getState: () => ({ theme: "dark" }), subscribe: () => () => {} },
}));
vi.mock("../data/liquidations", () => ({ subscribeLiquidations: () => () => {} }));
vi.mock("../data/coinalyze", () => ({ fetchLiquidationHistory: async () => [] }));
vi.mock("../data/daemon", () => ({
  liquidationsGet: async () => null,
  liquidationsPush: async () => false,
}));

import type { Candle } from "@axiom/types";
import type { LiqEvent } from "./liquidationMarkers";
import { construireGrille, intensiteLog, profilParPrix } from "./liquidationHeat";

function candle(partial: Partial<Candle> & Pick<Candle, "time" | "close">): Candle {
  return { open: 0, high: 0, low: 0, volume: 0, ...partial };
}

function ev(partial: Partial<LiqEvent> & Pick<LiqEvent, "time" | "side" | "price" | "usd">): LiqEvent {
  return { qty: 1, venue: "test", ...partial };
}

describe("construireGrille", () => {
  it("agrège deux liqs de la même bougie/bucket en une cellule", () => {
    // 2 events dans la bougie 0 (time 0), même prix → 1 cellule, count 2, longUsd sommé.
    const candles = [candle({ time: 0, close: 100 }), candle({ time: 60000, close: 100 })];
    const events = [
      ev({ time: 1000, side: "long", price: 100, usd: 500 }),
      ev({ time: 1500, side: "long", price: 100, usd: 300 }),
    ];
    const grid = construireGrille(events, candles, 0, 2);
    expect(grid).not.toBeNull();
    expect(grid?.cells.size).toBe(1);
    const cell = [...(grid?.cells.values() ?? [])][0];
    expect(cell?.count).toBe(2);
    expect(cell?.longUsd).toBe(800);
    expect(cell?.shortUsd).toBe(0);
    expect(grid?.maxUsd).toBe(800);
  });

  it("sépare long et short dans la cellule", () => {
    const candles = [candle({ time: 0, close: 100 }), candle({ time: 60000, close: 100 })];
    const events = [
      ev({ time: 1000, side: "long", price: 100, usd: 500 }),
      ev({ time: 1500, side: "short", price: 100, usd: 200 }),
    ];
    const grid = construireGrille(events, candles, 0, 2);
    const cell = [...(grid?.cells.values() ?? [])][0];
    expect(grid?.cells.size).toBe(1);
    expect(cell?.count).toBe(2);
    expect(cell?.longUsd).toBe(500);
    expect(cell?.shortUsd).toBe(200);
    expect(grid?.maxUsd).toBe(700);
  });

  it("écarte les événements hors de la plage [from, to)", () => {
    // Bougies 0..2 ; on ne visualise que [1, 2) → seule la bougie 1 (time 60000) compte.
    const candles = [
      candle({ time: 0, close: 100 }),
      candle({ time: 60000, close: 100 }),
      candle({ time: 120000, close: 100 }),
    ];
    const events = [
      ev({ time: 1000, side: "long", price: 100, usd: 500 }), // bougie 0 → écarté
      ev({ time: 61000, side: "long", price: 100, usd: 300 }), // bougie 1 → gardé
      ev({ time: 121000, side: "long", price: 100, usd: 999 }), // bougie 2 → hors plage
    ];
    const grid = construireGrille(events, candles, 1, 2);
    expect(grid?.cells.size).toBe(1);
    const cell = [...(grid?.cells.values() ?? [])][0];
    expect(cell?.candleTime).toBe(60000);
    expect(cell?.longUsd).toBe(300);
  });

  it("renvoie null si aucune bougie visible ou aucune cellule", () => {
    const candles = [candle({ time: 0, close: 100 }), candle({ time: 60000, close: 100 })];
    // Plage vide → null.
    expect(construireGrille([], candles, 1, 1)).toBeNull();
    // Aucun événement → 0 cellule → null.
    expect(construireGrille([], candles, 0, 2)).toBeNull();
  });
});

describe("intensiteLog", () => {
  it("0→0, max→1, croissante", () => {
    expect(intensiteLog(0, 100)).toBe(0);
    expect(intensiteLog(100, 100)).toBe(1);
    expect(intensiteLog(10, 100)).toBeGreaterThan(10 / 100); // la log RELÈVE les petits niveaux
  });

  it("clampe hors [0,1] et renvoie 0 si maxUsd <= 0", () => {
    expect(intensiteLog(200, 100)).toBe(1); // usd > max → clampé à 1
    expect(intensiteLog(50, 0)).toBe(0); // max invalide → 0
    expect(intensiteLog(50, -10)).toBe(0);
  });
});

describe("profilParPrix", () => {
  it("somme les cellules d'un même bucket sur toutes les bougies", () => {
    // Même prix (donc même bucketIdx) mais 2 bougies distinctes → 2 cellules, 1 bucket.
    const candles = [candle({ time: 0, close: 100 }), candle({ time: 60000, close: 100 })];
    const events = [
      ev({ time: 1000, side: "long", price: 100, usd: 500 }), // bougie 0
      ev({ time: 61000, side: "short", price: 100, usd: 200 }), // bougie 1
    ];
    const grid = construireGrille(events, candles, 0, 2);
    expect(grid?.cells.size).toBe(2);
    const profil = profilParPrix(grid!);
    expect(profil.size).toBe(1);
    const [entree] = [...profil.values()];
    expect(entree?.longUsd).toBe(500);
    expect(entree?.shortUsd).toBe(200);
  });
});
