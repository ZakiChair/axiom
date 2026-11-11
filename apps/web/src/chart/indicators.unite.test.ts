/**
 * Branchement de l'unité supérieure dans `ChartIndicators` (SUG-1, phase 1) : module
 * chargé à la demande, statuts publiés (chargement, refus motivé), légende « [4h] », et
 * recalcul de la seule instance concernée à l'arrivée des bougies supérieures.
 * Place simulée (aucun réseau) ; seule l'horloge `Date` est simulée.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Chart } from "klinecharts";
import type { Candle, IndicatorResult } from "@axiom/types";
import { getIndicator } from "@axiom/indicators";
import type { ActiveIndicator } from "../store/indicators";

vi.mock("klinecharts", () => ({
  registerIndicator: () => {},
  registerOverlay: () => {},
  IndicatorSeries: { Normal: "normal", Price: "price", Volume: "volume" },
}));
const { fetchKlines } = vi.hoisted(() => ({ fetchKlines: vi.fn() }));
vi.mock("../data/adapters", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/adapters")>()),
  getAdapter: () => ({ fetchKlines, subscribeKline: () => () => {}, subscribeTrades: () => () => {} }),
}));

import { ChartIndicators, libelleInstance, statutIndicateur } from "./indicators";
import { presentationStatut } from "./paneHeaders";
import { viderCacheUnite } from "./bougiesUnite";

const H = 3_600_000;
const BLOC = Date.UTC(2025, 0, 6) + 700 * 4 * H;

interface ConfigStub {
  name: string;
  shortName?: string;
  extendData?: IndicatorResult;
}

function monter() {
  const chart = {
    createIndicator: vi.fn((_c: ConfigStub, _s: boolean, opts?: { id: string }) => opts?.id ?? null),
    overrideIndicator: vi.fn((_o: ConfigStub, _paneId?: string) => {}),
    removeIndicator: vi.fn(),
    getSize: vi.fn(() => ({ top: 0, left: 0, width: 800, height: 100, right: 800, bottom: 100 })),
    setPaneOptions: vi.fn(),
  };
  return { chart, indicators: new ChartIndicators(chart as unknown as Chart) };
}

/** Bougies 4h servies par la place : 600 closes jusqu'à BLOC, puis la bougie en cours. */
function bougies4h(): Candle[] {
  return Array.from({ length: 601 }, (_, i) => {
    const time = BLOC - 600 * 4 * H + i * 4 * H;
    const close = 100 + Math.sin(i / 7) * 10;
    return { time, open: close, high: close + 1, low: close - 1, close, volume: 1, closed: i < 600 };
  });
}

function graphe1h(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const time = BLOC + 2 * H - (n - 1 - i) * H;
    return { time, open: 1, high: 1, low: 1, close: 1, volume: 1 };
  });
}

const ema4h: ActiveIndicator = { instanceId: "ema-4h", defId: "ema", params: { length: 20, unite: "4h" }, couleurIdx: 0 };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(BLOC + 2.5 * H);
  viderCacheUnite();
  fetchKlines.mockReset();
  fetchKlines.mockResolvedValue(bougies4h());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ChartIndicators — unité supérieure", () => {
  it("chargement puis tracé : légende « EMA (20) [4h] », statut levé, une seule requête", async () => {
    const { chart, indicators } = monter();
    const candles = graphe1h(120);
    indicators.setMarket("BTCUSDT", "1h");
    indicators.sync([ema4h], candles, "binance");

    const [config] = chart.createIndicator.mock.calls[0]!;
    expect(config.shortName).toBe("EMA (20) [4h] …");
    expect(config.extendData?.series.ema?.every((v) => v === undefined)).toBe(true);
    expect(statutIndicateur(chart as unknown as Chart, "ema-4h")).toEqual({ etat: "chargement", raison: "Chargement des bougies 4h…" });

    await vi.waitFor(() => {
      const dernier = chart.overrideIndicator.mock.calls.at(-1)?.[0];
      expect(dernier?.extendData?.series.ema?.some((v) => typeof v === "number")).toBe(true);
    });
    const [override, paneId] = chart.overrideIndicator.mock.calls.at(-1)!;
    expect(paneId).toBe("candle_pane");
    expect(override.shortName).toBe("EMA (20) [4h]");
    expect(override.extendData?.series.ema).toHaveLength(candles.length);
    expect(statutIndicateur(chart as unknown as Chart, "ema-4h")).toBeNull();
    expect(fetchKlines).toHaveBeenCalledTimes(1);
    expect(fetchKlines).toHaveBeenCalledWith("BTCUSDT", "4h", { limit: 500 });

    // Recalcul à la clôture d'une bougie 1h du même bloc 4h : aucune requête de plus.
    indicators.recompute([ema4h], graphe1h(121), "binance");
    expect(fetchKlines).toHaveBeenCalledTimes(1);
    expect(chart.overrideIndicator.mock.calls.at(-1)![0].shortName).toBe("EMA (20) [4h]");
  });

  it("unité refusée sur ce graphe : rien de tracé, motif publié, aucune requête", async () => {
    const { chart, indicators } = monter();
    indicators.setMarket("BTCUSDT", "4h");
    indicators.sync([ema4h], graphe1h(50), "binance");
    await vi.waitFor(() =>
      expect(statutIndicateur(chart as unknown as Chart, "ema-4h")).toEqual({
        etat: "unusable",
        raison: "Unité 4h non proposée sur un graphe 4h (1d, 1w)",
      }),
    );
    const dernier = chart.overrideIndicator.mock.calls.at(-1)?.[0] ?? chart.createIndicator.mock.calls.at(-1)![0];
    expect(dernier.extendData?.series.ema?.every((v) => v === undefined)).toBe(true);
    expect(fetchKlines).not.toHaveBeenCalled();
  });

  it("échec de la place : statut UNUSABLE avec la raison, jamais de valeur inventée", async () => {
    fetchKlines.mockRejectedValue(new Error("HTTP 418"));
    const { chart, indicators } = monter();
    indicators.setMarket("BTCUSDT", "1h");
    indicators.sync([ema4h], graphe1h(50), "binance");
    await vi.waitFor(() =>
      expect(statutIndicateur(chart as unknown as Chart, "ema-4h")).toEqual({
        etat: "unusable",
        raison: "Bougies 4h indisponibles : HTTP 418",
      }),
    );
  });

  it("historique supérieur court : valeurs tracées, badge « partiel » avec sa raison", async () => {
    fetchKlines.mockResolvedValue(bougies4h().slice(-30)); // 29 bougies 4h closes + la bougie en cours
    const { chart, indicators } = monter();
    indicators.setMarket("BTCUSDT", "1h");
    indicators.sync([ema4h], graphe1h(120), "binance");
    await vi.waitFor(() =>
      expect(statutIndicateur(chart as unknown as Chart, "ema-4h")).toEqual({
        etat: "partiel",
        raison: "29 bougies 4h : historique trop court pour le début du graphe",
      }),
    );
    const serie = chart.overrideIndicator.mock.calls.at(-1)![0].extendData!.series.ema!;
    expect(serie[0]).toBeUndefined();
    expect(typeof serie.at(-1)).toBe("number");
  });

  it("une instance sans unité ne charge rien (calcul natif inchangé)", () => {
    const { chart, indicators } = monter();
    indicators.setMarket("BTCUSDT", "1h");
    indicators.sync([{ instanceId: "ema", defId: "ema", params: { length: 3 }, couleurIdx: 0 }], graphe1h(10), "binance");
    expect(chart.createIndicator.mock.calls[0]![0].shortName).toBe("EMA (3)");
    expect(fetchKlines).not.toHaveBeenCalled();
  });
});

describe("légende et badge", () => {
  it("libellé suffixé de l'unité, inchangé sans elle", () => {
    const ema = getIndicator("ema")!;
    expect(libelleInstance(ema, { length: 50, unite: "1d" })).toBe("EMA (50) [1d]");
    expect(libelleInstance(ema, { length: 50 })).toBe("EMA (50)");
  });

  it("badge « partiel » quand le début du graphe n'est pas couvert", () => {
    expect(presentationStatut({ etat: "partiel", raison: "120 bougies 1w : historique trop court pour le début du graphe" })).toEqual({
      badge: "partiel",
      raison: "120 bougies 1w : historique trop court pour le début du graphe",
    });
  });
});
