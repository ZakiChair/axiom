/**
 * Extension du backfill aux sessions UTC ENTIÈRES (constat « VWAP et pivots
 * lisent une session tronquée »).
 *
 * Le backfill initial est borné à 500 bougies : en 1 min il démarre en milieu
 * de journée, donc la VWAP s'ancre au mauvais endroit et les pivots lisent une
 * veille tronquée. Ces deux fonctions PURES décident jusqu'où remonter et de
 * combien de bougies par page — et surtout : elles ne demandent RIEN quand
 * aucune définition sessionnée n'est active.
 *
 * NOTE environnement : même préambule que `backfillDelai.test.ts` — le graphe
 * d'import de `ChartInstance.tsx` touche `document` et enregistre des overlays
 * klinecharts dès l'import.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const noop = (): void => {};
  const faireElement = (): Record<string, unknown> => ({
    style: {},
    classList: { add: noop, remove: noop, contains: () => false, toggle: noop },
    setAttribute: noop,
    getAttribute: () => null,
    removeAttribute: noop,
    appendChild: noop,
    removeChild: noop,
    addEventListener: noop,
    removeEventListener: noop,
    getContext: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  });
  const g = globalThis as Record<string, unknown>;
  g.document = {
    documentElement: faireElement(),
    body: faireElement(),
    head: faireElement(),
    createElement: faireElement,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop,
  };
  g.window = globalThis;
  g.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
  g.requestAnimationFrame = () => 1;
  g.cancelAnimationFrame = noop;
  g.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

// Le bundle réel n'expose rien d'utilisable sous node (index.cjs délègue à l'UMD) :
// on stube la surface consommée par le graphe d'import de ChartInstance.
vi.mock("klinecharts", () => ({
  init: () => null,
  dispose: () => {},
  registerIndicator: () => {},
  registerOverlay: () => {},
  ActionType: {
    OnCrosshairChange: "onCrosshairChange",
    OnDataReady: "onDataReady",
    OnPaneDrag: "onPaneDrag",
    OnScroll: "onScroll",
    OnVisibleRangeChange: "onVisibleRangeChange",
    OnZoom: "onZoom",
  },
  DomPosition: { Main: "main", Root: "root", YAxis: "yAxis" },
  IndicatorSeries: { Normal: "normal", Price: "price", Volume: "volume" },
  LoadDataType: { Forward: "forward", Backward: "backward", Init: "init" },
  TooltipShowRule: { Always: "always", None: "none", FollowCross: "follow_cross" },
  YAxisType: { Normal: "normal", Log: "log", Percentage: "percentage" },
  OverlayFigureIgnoreEventType: { None: "none" },
  PolygonType: { Fill: "fill", Stroke: "stroke" },
  LineType: { Solid: "solid", Dashed: "dashed" },
}));

import type { Candle } from "@axiom/types";
import { cibleSessionUTC, limitePageSession, pasBougiesMs } from "./ChartInstance";

const JOUR_MS = 86_400_000;
const HEURE_MS = 3_600_000;
const MINUTE_MS = 60_000;

// Dernière bougie : jour UTC 20000, 13:59.
const DERNIER = 20_000 * JOUR_MS + 13 * HEURE_MS + 59 * MINUTE_MS;

describe("cibleSessionUTC", () => {
  it("aucune définition sessionnée active -> undefined (coût réseau inchangé)", () => {
    expect(cibleSessionUTC([], DERNIER)).toBeUndefined();
    expect(cibleSessionUTC(["rsi", "ema", "macd"], DERNIER)).toBeUndefined();
  });

  it("VWAP seule -> minuit UTC du jour COURANT", () => {
    expect(cibleSessionUTC(["vwap"], DERNIER)).toBe(20_000 * JOUR_MS);
    expect(cibleSessionUTC(["vwapBands"], DERNIER)).toBe(20_000 * JOUR_MS);
  });

  it("pivots -> minuit UTC de la VEILLE (la veille doit être entière)", () => {
    for (const id of ["pivotStandard", "pivotCamarilla", "pivotDemark", "pivotFibonacci", "pivotWoodie"]) {
      expect(cibleSessionUTC([id], DERNIER)).toBe(19_999 * JOUR_MS);
    }
  });

  it("prend la profondeur MAXIMALE quand VWAP et pivots coexistent", () => {
    expect(cibleSessionUTC(["vwap", "rsi", "pivotWoodie"], DERNIER)).toBe(19_999 * JOUR_MS);
  });
});

describe("limitePageSession", () => {
  it("0 quand le buffer couvre déjà la cible (rien à demander)", () => {
    expect(limitePageSession(20_000 * JOUR_MS, 20_000 * JOUR_MS, MINUTE_MS, 500)).toBe(0);
    expect(limitePageSession(20_000 * JOUR_MS + 1, 20_000 * JOUR_MS + 5, MINUTE_MS, 500)).toBe(0);
  });

  it("plafonne à la taille de page tant que le manque la dépasse", () => {
    // Buffer démarrant à 20:00 UTC : 20 h manquantes en 1 min = 1200 bougies > page.
    expect(limitePageSession(20_000 * JOUR_MS + 20 * HEURE_MS, 20_000 * JOUR_MS, MINUTE_MS, 500)).toBe(500);
  });

  it("ROGNE la dernière page au strict nécessaire (jamais plus que la cible)", () => {
    const premier = 20_000 * JOUR_MS + 5 * HEURE_MS + 40 * MINUTE_MS; // 05:40 UTC
    expect(limitePageSession(premier, 20_000 * JOUR_MS, MINUTE_MS, 500)).toBe(340);
    // En 5 min, la même profondeur ne coûte que 68 bougies.
    expect(limitePageSession(premier, 20_000 * JOUR_MS, 5 * MINUTE_MS, 500)).toBe(68);
  });

  it("timeframe non résolu (0 ms) -> 0, jamais de division par zéro", () => {
    expect(limitePageSession(DERNIER, 20_000 * JOUR_MS, 0, 500)).toBe(0);
  });
});

describe("pasBougiesMs", () => {
  const bougie = (time: number): Candle => ({ time, open: 1, high: 1, low: 1, close: 1, volume: 0 });

  it("mesure le pas réel du buffer (500 bougies 1 min)", () => {
    const buffer = Array.from({ length: 500 }, (_, i) => bougie(DERNIER - (499 - i) * MINUTE_MS));
    expect(pasBougiesMs(buffer)).toBe(MINUTE_MS);
  });

  it("0 quand le buffer n'a pas deux bougies (pas mesurable)", () => {
    expect(pasBougiesMs([])).toBe(0);
    expect(pasBougiesMs([bougie(DERNIER)])).toBe(0);
  });
});
