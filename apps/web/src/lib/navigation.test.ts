/**
 * Tests des helpers PURES du bus navigation panneau → chart (Lot C2).
 *
 * navigation.ts importe klinecharts + drawing (effet de bord navigateur) : mocks
 * inertes, même pattern que registry.test.ts / tradeMarkers.test.ts.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("klinecharts", () => ({ registerOverlay: () => {} }));
vi.mock("../chart/drawing", () => ({
  getActiveChart: () => null,
  setFocusChart: () => {},
}));
vi.mock("../store/chart-layout", () => ({
  chartLayoutStore: { getState: () => ({ setFocus: () => {} }) },
}));
vi.mock("../store/market", () => ({
  marketStore: {
    getState: () => ({
      candles: [],
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
