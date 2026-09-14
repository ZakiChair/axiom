/**
 * Dimensionnement du bucket AVANT le premier rendu du footprint.
 *
 * Au démarrage réel, le backfill remplit le buffer AVANT que le footprint ne soit activé.
 * `start()` enchaînait alors `loop()` → `render()` de façon SYNCHRONE alors que `bucketSize`
 * valait encore son défaut (0,01). Aucune bougie n'ayant été vue en live, toutes passaient
 * par le chemin approché, qui génère (high − low) / bucketSize lignes PAR bougie visible.
 * Mesuré dans Chrome sur BTCUSDT (110 bougies) : 1 149 873 lignes pour UNE bougie et
 * ~108 millions au total → fil principal gelé en ~2 s, puis onglet tué par épuisement
 * mémoire. `recomputeBucket()` (qui vise TARGET_ROWS_PER_CANDLE lignes) n'intervenait
 * qu'ensuite : via `onCandles()`, ou dans la microtâche de `resolveTick()` appelée par
 * `ensureTrades()` — toujours après ce premier rendu.
 *
 * Ce parcours couvre l'ordre réel du démarrage, celui que `orderflow.cadence` évite
 * explicitement en ne poussant les bougies qu'APRÈS le start.
 */
import { describe, expect, it, vi } from "vitest";
import type { Candle, ExchangeId } from "@axiom/types";
import type { Chart } from "klinecharts";
import type { MarketStore } from "../store/market";

// Même stub qu'`orderflow.cadence` : le bundle klinecharts est inerte hors navigateur.
vi.mock("klinecharts", () => ({
  registerIndicator: () => {},
  registerOverlay: () => {},
  ActionType: {
    OnCrosshairChange: "onCrosshairChange",
    OnScroll: "onScroll",
    OnVisibleRangeChange: "onVisibleRangeChange",
    OnZoom: "onZoom",
  },
  IndicatorSeries: { Normal: "normal", Price: "price", Volume: "volume" },
  TooltipShowRule: { Always: "always", None: "none" },
  YAxisType: { Normal: "normal", Log: "log", Percentage: "percentage" },
}));

// Un buffer non vide au start déclenche `ensureTrades()` : sans cette doublure, le test
// ouvrirait un vrai flux WebSocket.
vi.mock("../data/adapters", () => ({
  getAdapter: () => ({ subscribeTrades: () => () => {} }),
}));

// Au boot réel la source est « binance » : `resolveTick()` AWAIT /exchangeInfo. La requête
// est donc encore EN VOL pendant `start()`. Cette doublure reproduit cette attente sans
// réseau — c'est la condition qui rend la course observable (sur une autre source,
// `resolveTick()` n'a aucun await et dimensionne le bucket de façon synchrone).
vi.mock("../data/binance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/binance")>()),
  fetchSymbolInfo: () => new Promise<never>(() => {}),
}));

import { OrderflowController } from "./orderflow";
import { rowsApprochees } from "./openCloseNet.calc";

/** Bougie BTCUSDT réelle relevée dans Chrome à l'instant du gel (plage ≈ 11 500 $). */
const BOUGIE_BTC: Candle = {
  time: 1_700_000_000_000,
  open: 35_000,
  high: 45_821,
  low: 34_322.28,
  close: 44_000,
  volume: 1_253_514.219,
  buyVolume: 700_000,
  sellVolume: 553_514.219,
  closed: true,
};

/**
 * Monte le contrôleur dans l'ordre RÉEL du démarrage : bougies déjà présentes, puis
 * activation. `render` est remplacé par une sonde qui relève `bucketSize` au moment
 * exact du premier rendu — c'est l'ordonnancement qu'on vérifie, pas le dessin.
 */
function monterAvecBougies(bougies: Candle[]): { bucketsAuRendu: number[] } {
  vi.stubGlobal("performance", { now: () => 0 });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("ResizeObserver", class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
  vi.stubGlobal("window", { devicePixelRatio: 1, setInterval: () => 0, clearInterval: () => {} });

  const store = {
    getState: () => ({ candles: bougies, exchange: "binance" as ExchangeId, timeframe: "4h" }),
  } as unknown as MarketStore;

  const ctx = { setTransform: () => {}, clearRect: () => {} };
  const canvas = { style: {}, width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  const container = { clientWidth: 1600, clientHeight: 900 } as unknown as HTMLElement;
  const chart = {
    subscribeAction: () => {},
    unsubscribeAction: () => {},
    createIndicator: () => null,
    removeIndicator: () => {},
    overrideIndicator: () => {},
    convertToPixel: () => ({ x: 0, y: 0 }),
  } as unknown as Chart;

  const ctrl = new OrderflowController(chart, container, canvas, "BTCUSDT", store);
  const bucketsAuRendu: number[] = [];
  vi.spyOn(ctrl as unknown as { render: () => void }, "render").mockImplementation(() => {
    bucketsAuRendu.push((ctrl as unknown as { bucketSize: number }).bucketSize);
    (ctrl as unknown as { dirty: boolean }).dirty = false;
  });

  ctrl.setEnabled(true);
  return { bucketsAuRendu };
}

describe("OrderflowController — bucket dimensionné avant le premier rendu", () => {
  it("borne les lignes approchées dès le premier rendu quand le backfill précède l'activation", () => {
    const { bucketsAuRendu } = monterAvecBougies([BOUGIE_BTC]);

    expect(bucketsAuRendu.length).toBeGreaterThan(0);
    const bucket = bucketsAuRendu[0] ?? 0;
    const lignes = rowsApprochees(BOUGIE_BTC, bucket).length;

    // recomputeBucket() vise TARGET_ROWS_PER_CANDLE (24) lignes sur une bougie typique.
    // Une marge large suffit à distinguer un bucket dimensionné (≈ 25 lignes) du défaut
    // 0,01 qui en produisait 1 149 873.
    expect(lignes).toBeLessThan(100);
  });
});
