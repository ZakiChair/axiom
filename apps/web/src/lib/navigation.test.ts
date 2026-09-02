/**
 * Tests du bus navigation panneau → chart (Lot C2) : helpers PURES, plus le suivi du
 * marqueur vertical quand le chart focus bascule (grille multi-chart).
 *
 * navigation.ts importe klinecharts + drawing (effet de bord navigateur) : mocks
 * inertes, même pattern que registry.test.ts / tradeMarkers.test.ts.
 */
import { describe, expect, it, vi } from "vitest";

// État mutable partagé avec les mocks : permet de faire BASCULER le chart focus
// (grille 2×2) et de simuler des bougies présentes pour le test du marqueur.
const etat = vi.hoisted(() => ({
  chartActif: null as unknown,
  candles: [] as unknown[],
}));

vi.mock("klinecharts", () => ({ registerOverlay: () => {} }));
vi.mock("../chart/drawing", () => ({
  getActiveChart: () => etat.chartActif,
  setFocusChart: () => {},
}));
vi.mock("../store/chart-layout", () => ({
  chartLayoutStore: { getState: () => ({ setFocus: () => {} }) },
}));
vi.mock("../store/market", () => ({
  marketStore: {
    getState: () => ({
      candles: etat.candles,
      setExchange: () => {},
      setSymbol: () => {},
      setTimeframe: () => {},
    }),
    subscribe: () => () => {},
  },
}));

import {
  champsMarche,
  etiquetteMarqueur,
  markTimeValide,
  navigateTo,
  tronquerLabel,
  type NavIntent,
} from "./navigation";

describe("markTimeValide", () => {
  it("accepte un epoch ms strictement positif", () => {
    expect(markTimeValide(1_700_000_000_000)).toBe(true);
  });

  it("rejette undefined, null, 0, NaN, négatif", () => {
    expect(markTimeValide(undefined)).toBe(false);
    expect(markTimeValide(null)).toBe(false);
    expect(markTimeValide(0)).toBe(false);
    expect(markTimeValide(Number.NaN)).toBe(false);
    expect(markTimeValide(-1)).toBe(false);
  });
});

describe("tronquerLabel", () => {
  it("tronque au-delà de n caractères avec ellipse", () => {
    expect(tronquerLabel("abcdefghijklmnopqrstuvwxyz", 10)).toBe("abcdefghi…");
  });

  it("conserve une chaîne courte intacte et trim", () => {
    expect(tronquerLabel("  ECO  ")).toBe("ECO");
  });

  it("chaîne vide → vide", () => {
    expect(tronquerLabel("   ")).toBe("");
  });
});

describe("etiquetteMarqueur", () => {
  it("priorise markLabel custom", () => {
    expect(etiquetteMarqueur({ source: "eco", markLabel: "NFP USD" })).toBe("NFP USD");
  });

  it("mappe les sources connues vers un mnémonique", () => {
    expect(etiquetteMarqueur({ source: "eqs" })).toBe("EQS");
    expect(etiquetteMarqueur({ source: "news" })).toBe("NEWS");
    expect(etiquetteMarqueur({ source: "eco" })).toBe("ECO");
    expect(etiquetteMarqueur({ source: "brief" })).toBe("BRIEF");
    expect(etiquetteMarqueur({ source: "map" })).toBe("MAP");
    expect(etiquetteMarqueur({ source: "screener" })).toBe("EQS");
  });

  it("source inconnue → uppercase tronqué", () => {
    // « CUSTOMSRC » (9) → tronqué à 8 : 7 chars + …
    expect(etiquetteMarqueur({ source: "customsrc" })).toBe("CUSTOMS…");
  });
});

describe("champsMarche", () => {
  it("n'extrait que les champs marché renseignés", () => {
    const intent: NavIntent = {
      source: "eqs",
      symbol: " ETHUSDT ",
      exchange: "binance",
      timeframe: "15m",
      markTime: 1_700_000_000_000,
    };
    expect(champsMarche(intent)).toEqual({
      symbol: "ETHUSDT",
      exchange: "binance",
      timeframe: "15m",
    });
  });

  it("ignore symbole vide et champs absents", () => {
    expect(champsMarche({ source: "news", symbol: "  " })).toEqual({});
    expect(champsMarche({ source: "eco", markTime: 123 })).toEqual({});
  });
});

/** Faux chart KLineChart : compte les overlays portés et les retraits reçus. */
function fauxChart() {
  const overlays: unknown[] = [];
  return {
    overlays,
    retraits: 0,
    createOverlay(o: unknown) {
      overlays.push(o);
    },
    removeOverlay() {
      this.retraits += 1;
      overlays.length = 0;
    },
    scrollToTimestamp() {},
  };
}

describe("marqueur de navigation en grille multi-chart", () => {
  it("retire le marqueur sur l'ANCIEN porteur quand le focus change", () => {
    const chartA = fauxChart();
    const chartB = fauxChart();
    etat.candles = [{ timestamp: 1 }];

    etat.chartActif = chartA;
    navigateTo({ source: "eqs", markTime: 1_700_000_000_000 });
    expect(chartA.overlays.length).toBe(1);

    // Clic sur le slot secondaire : le focus bascule, le marqueur doit SUIVRE.
    etat.chartActif = chartB;
    const retraitsAvant = chartA.retraits;
    navigateTo({ source: "news", markTime: 1_700_000_060_000 });

    expect(chartA.retraits).toBeGreaterThan(retraitsAvant);
    expect(chartA.overlays.length).toBe(0);
    expect(chartB.overlays.length).toBe(1);
  });
});
