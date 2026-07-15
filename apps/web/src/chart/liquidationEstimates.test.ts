/**
 * Tests de la fonction PURE `calculerNiveauxEstimes` — modèle de levier appliqué à l'OI.
 * Couvre : OI plat → aucun niveau ; hausse d'OI (close=100) → longs {90,96,98,99} et
 * shorts {110,104,102,101} au poids ΔOI/8 ; niveau consommé par une bougie ultérieure qui
 * traverse le prix (long 96 traversé par low<96 → absent, mais long 90 conservé).
 *
 * ATTENTION : ces niveaux sont une APPROXIMATION (garde-fou BUILD-CONTRACT — toujours
 * étiquetés « EST. » à l'écran), distincts des liquidations RÉELLES de la heatmap.
 */
import { describe, it, expect, vi } from "vitest";

// liquidationEstimates importe ./liquidationMarkers (effets de bord à l'import :
// registerOverlay, ./drawing, ../store/theme, abonnements aux flux) et ../data/coinalyze :
// mêmes stubs que liquidationHeat.test.ts pour importer la fonction PURE sous Node.
vi.mock("klinecharts", () => ({ registerOverlay: () => {} }));
vi.mock("./drawing", () => ({ getActiveChart: () => null }));
vi.mock("../store/theme", () => ({
  themeStore: { getState: () => ({ theme: "dark" }), subscribe: () => () => {} },
}));
vi.mock("../data/liquidations", () => ({ subscribeLiquidations: () => () => {} }));
vi.mock("../data/coinalyze", () => ({
  fetchLiquidationHistory: async () => [],
  fetchOpenInterestHistoryBatch: async () => new Map(),
}));
vi.mock("../data/daemon", () => ({
  liquidationsGet: async () => null,
  liquidationsPush: async () => false,
}));

import type { Candle } from "@axiom/types";
import { calculerNiveauxEstimes, LEVIERS } from "./liquidationEstimates";

function candle(partial: Partial<Candle> & Pick<Candle, "time" | "close">): Candle {
  return { open: partial.close, high: partial.close, low: partial.close, volume: 0, ...partial };
}

/** Prix long/short attendus pour entry=100 et LEVIERS = [10,25,50,100]. */
const LONGS_100 = [90, 96, 98, 99];
const SHORTS_100 = [110, 104, 102, 101];

describe("calculerNiveauxEstimes", () => {
  it("OI plat (ΔOI = 0) → aucun niveau", () => {
    const candles = [candle({ time: 1000, close: 100 })];
    const oiHist = [
      { time: 1000, oiUsd: 1000 },
      { time: 1500, oiUsd: 1000 },
    ];
    expect(calculerNiveauxEstimes(oiHist, candles)).toEqual([]);
  });

  it("OI en baisse → aucun niveau", () => {
    const candles = [candle({ time: 1000, close: 100 })];
    const oiHist = [
      { time: 1000, oiUsd: 2000 },
      { time: 1500, oiUsd: 1000 },
    ];
    expect(calculerNiveauxEstimes(oiHist, candles)).toEqual([]);
  });

  it("hausse d'OI (close=100, aucune traversée) → 8 niveaux au poids ΔOI/8", () => {
    // Une seule bougie contenante (pas de bougie ultérieure → rien n'est consommé).
    const candles = [candle({ time: 1000, close: 100 })];
    const oiHist = [
      { time: 1000, oiUsd: 1000 },
      { time: 1500, oiUsd: 2000 }, // ΔOI = 1000 → poids = 1000/8 = 125 par niveau
    ];
    const niveaux = calculerNiveauxEstimes(oiHist, candles);

    expect(niveaux.length).toBe(8);
    const longs = niveaux.filter((n) => n.side === "long").map((n) => n.price).sort((a, b) => a - b);
    const shorts = niveaux.filter((n) => n.side === "short").map((n) => n.price).sort((a, b) => a - b);
    for (let i = 0; i < LONGS_100.length; i++) {
      expect(longs[i]).toBeCloseTo(LONGS_100[i] as number, 6);
    }
    for (let i = 0; i < SHORTS_100.length; i++) {
      expect(shorts[i]).toBeCloseTo(([...SHORTS_100].sort((a, b) => a - b)[i]) as number, 6);
    }
    for (const n of niveaux) expect(n.poidsUsd).toBeCloseTo(125, 6);
    // Chaque levier apparaît une fois par côté.
    for (const L of LEVIERS) {
      expect(niveaux.filter((n) => n.levier === L).length).toBe(2);
    }
  });

  it("niveau long 96 traversé par une bougie ultérieure (low<96) → absent ; long 90 conservé", () => {
    // Bougie A (time 1000) = entrée close=100 ; bougie B (time 2000) ULTÉRIEURE avec low=95.5
    // traverse 96/98/99 (≥95.5) mais pas 90 ; high=100 ne traverse aucun short (<101).
    const candles = [
      candle({ time: 1000, close: 100 }),
      candle({ time: 2000, close: 98, high: 100, low: 95.5 }),
    ];
    const oiHist = [
      { time: 1000, oiUsd: 1000 },
      { time: 1500, oiUsd: 2000 }, // ΔOI dans la bougie A
    ];
    const niveaux = calculerNiveauxEstimes(oiHist, candles);
    const longs = niveaux.filter((n) => n.side === "long").map((n) => n.price);
    const shorts = niveaux.filter((n) => n.side === "short").map((n) => n.price);

    // 96, 98, 99 consommés ; seul 90 survit côté long.
    expect(longs.some((p) => Math.abs(p - 96) < 1e-6)).toBe(false);
    expect(longs.some((p) => Math.abs(p - 98) < 1e-6)).toBe(false);
    expect(longs.some((p) => Math.abs(p - 99) < 1e-6)).toBe(false);
    expect(longs.some((p) => Math.abs(p - 90) < 1e-6)).toBe(true);
    // Aucun short traversé (high 100 < 101).
    expect(shorts.length).toBe(4);
  });

  it("entrées vides / insuffisantes → aucun niveau", () => {
    expect(calculerNiveauxEstimes([], [])).toEqual([]);
    expect(calculerNiveauxEstimes([{ time: 1000, oiUsd: 1000 }], [candle({ time: 1000, close: 100 })])).toEqual([]);
    expect(calculerNiveauxEstimes([{ time: 1000, oiUsd: 1000 }, { time: 1500, oiUsd: 2000 }], [])).toEqual([]);
  });
});
