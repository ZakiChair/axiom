/**
 * Cadence des repaints du footprint déclenchés par les trades.
 *
 * Le client Binance émet UN rappel par message aggTrade (aucune coalescence) : sur
 * BTCUSDT le flux dépasse largement 60 msg/s. Chaque `render()` reconstruit toutes les
 * colonnes visibles (plafond 60) alors que seule la bougie en cours change d'un trade à
 * l'autre. Les repaints issus des trades sont donc bornés par `createRafThrottle` avec la
 * même constante que le chemin store→chart (`TICK_MIN_INTERVAL_MS`), tandis que le scroll
 * et le zoom (`onViewport`) doivent rester SYNCHRONES.
 *
 * Le rAF et l'horloge monotone sont faux (file de callbacks drainée à la main) : c'est la
 * seule façon d'observer la cadence sans dépendre du vrai vsync.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Candle, ExchangeId, Trade } from "@axiom/types";
import type { Chart } from "klinecharts";
import type { MarketStore } from "../store/market";

// Le bundle réel n'expose rien d'utilisable sous node (index.cjs délègue à l'UMD, inerte
// hors navigateur) : on stube la surface consommée à l'import, comme `indicators.throttle`.
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

import { OrderflowController, TICK_MIN_INTERVAL_MS } from "./orderflow";

function bougie(time: number): Candle {
  return {
    time,
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 10,
    buyVolume: 6,
    sellVolume: 4,
    closed: false,
  };
}

function trade(time: number): Trade {
  return { time, price: 100.5, qty: 0.1, side: "buy" };
}

/**
 * Monte un contrôleur sur des doublures minimales, avec rAF et horloge pilotés à la main.
 * `frame()` draine la file de callbacks courante (une « vsync »), `avancer()` bouge l'horloge.
 */
function monter() {
  let horloge = 0;
  let file: (() => void)[] = [];
  vi.stubGlobal("performance", { now: () => horloge });
  vi.stubGlobal("requestAnimationFrame", (cb: () => void): number => {
    file.push(cb);
    return file.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("ResizeObserver", class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
  vi.stubGlobal("window", { devicePixelRatio: 1, setInterval: () => 0, clearInterval: () => {} });

  const bougies: Candle[] = [];
  const store = {
    // Source « bybit » : sourceFournitCvd est faux → aucun sous-pane CVD, aucun flux réseau.
    getState: () => ({ candles: bougies, exchange: "bybit" as ExchangeId, timeframe: "1m" }),
  } as unknown as MarketStore;

  const ctx = { setTransform: () => {}, clearRect: () => {} };
  const canvas = { style: {}, width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  const container = { clientWidth: 800, clientHeight: 600 } as unknown as HTMLElement;
  const chart = {
    subscribeAction: () => {},
    unsubscribeAction: () => {},
    createIndicator: () => null,
    removeIndicator: () => {},
    overrideIndicator: () => {},
    convertToPixel: () => ({ x: 0, y: 0 }),
  } as unknown as Chart;

  const ctrl = new OrderflowController(chart, container, canvas, "BTCUSDT", store);
  // `render` est isolé : on n'observe QUE la cadence, pas le dessin. Le stub consomme
  // `dirty` comme le vrai rendu.
  const render = vi
    .spyOn(ctrl as unknown as { render: () => void }, "render")
    .mockImplementation(() => {
      (ctrl as unknown as { dirty: boolean }).dirty = false;
    });

  ctrl.setEnabled(true);
  // Les bougies arrivent APRÈS le start : un buffer non vide au start déclencherait
  // `ensureTrades()` (souscription WS réelle).
  bougies.push(bougie(0));

  return {
    ctrl,
    render,
    frame: (): void => {
      const aExecuter = file;
      file = [];
      for (const cb of aExecuter) cb();
    },
    avancer: (ms: number): void => {
      horloge += ms;
    },
    envoyerTrade: (): void => {
      (ctrl as unknown as { onTrade: (t: Trade) => void }).onTrade(trade(0));
    },
  };
}

describe("cadence des repaints du footprint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("borne les repaints issus des trades à un par intervalle minimal", () => {
    const { render, frame, avancer, envoyerTrade } = monter();
    frame(); // consomme le `dirty` initial posé par start()
    render.mockClear();

    // 6 trades entrecoupés de frames, horloge FIGÉE : un seul repaint doit passer.
    for (let i = 0; i < 6; i++) {
      envoyerTrade();
      frame();
      frame();
    }
    expect(render).toHaveBeenCalledTimes(1);

    // Une fois l'intervalle minimal écoulé, un nouveau repaint est autorisé.
    avancer(TICK_MIN_INTERVAL_MS);
    frame();
    frame();
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("l'intervalle est celui du chemin store→chart (100 ms)", () => {
    expect(TICK_MIN_INTERVAL_MS).toBe(100);
  });

  it("le scroll/zoom (onViewport) rend en synchrone, sans attendre de frame", () => {
    const { ctrl, render, frame } = monter();
    frame();
    render.mockClear();

    (ctrl as unknown as { onViewport: () => void }).onViewport();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("réactiver le footprint restaure les repaints throttlés", () => {
    const { ctrl, render, frame, avancer, envoyerTrade } = monter();
    ctrl.setEnabled(false);
    ctrl.setEnabled(true);
    frame();
    render.mockClear();

    avancer(TICK_MIN_INTERVAL_MS);
    envoyerTrade();
    frame();
    frame();
    expect(render).toHaveBeenCalledTimes(1);
  });
});
