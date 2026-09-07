import { afterEach, describe, expect, it, vi } from "vitest";
import type { Chart } from "klinecharts";
import type { Candle, IndicatorResult } from "@axiom/types";
import type { ActiveIndicator } from "../store/indicators";
import { ChartIndicators } from "./indicators";
import { auxProvider, type AuxStatus } from "./auxProvider";

vi.mock("klinecharts", () => ({
  registerIndicator: () => {},
  registerOverlay: () => {},
  IndicatorSeries: { Normal: "normal", Price: "price", Volume: "volume" },
}));

const candles: Candle[] = [100, 100, 110, 90, 90].map((close, i) => ({
  time: i * 3_600_000, open: close, high: close + 2, low: close - 2,
  close, volume: 1_000, closed: true,
}));

interface ConfigTrace { shortName?: string; extendData?: IndicatorResult }

function monter(instance: ActiveIndicator) {
  // Seule la frontière canvas est simulée : le contrôleur et les stratégies sont réels.
  const chart = {
    createIndicator: vi.fn((_config: ConfigTrace, _stack: boolean, options?: { id: string }) => options?.id ?? "candle_pane"),
    overrideIndicator: vi.fn(), removeIndicator: vi.fn(), setPaneOptions: vi.fn(),
    getSize: () => ({ top: 0, left: 0, width: 800, height: 100, right: 800, bottom: 100 }),
  };
  const controller = new ChartIndicators(chart as unknown as Chart);
  controller.setMarket("BTCUSDT", "1h");
  controller.sync([instance], candles, "binance");
  return chart.createIndicator.mock.calls[0]?.[0];
}

afterEach(() => vi.restoreAllMocks());

describe("stratégies de positionnement — intégration du contrôleur aux", () => {
  const instances: ActiveIndicator[] = [
    { instanceId: "fade", defId: "stratNetPositionFade", params: { seuilNet: 30, emaLength: 2 }, couleurIdx: 0 },
    { instanceId: "smart", defId: "stratSmartMoneyDivergence", params: { seuilSpread: 25 }, couleurIdx: 0 },
  ];

  it.each(instances)("achemine les séries reçues jusqu'aux entrées affichées ($defId)", (instance) => {
    const status: AuxStatus = {
      status: "ready",
      aux: { lsAccount: [1, 1, 0.25, 4, 4], lsTopTrader: [1, 1, 4, 0.25, 0.25] },
    };
    vi.spyOn(auxProvider, "getAligned").mockReturnValue(status);

    const config = monter(instance);

    expect(config?.extendData?.series.prixEntree).toEqual([undefined, undefined, 110, 90, 90]);
    expect(config?.shortName).not.toContain("UNUSABLE");
  });

  it.each(instances)("attend les séries auxiliaires sans fabriquer d'entrée ($defId)", (instance) => {
    vi.spyOn(auxProvider, "getAligned").mockReturnValue({ status: "pending" });

    const config = monter(instance);

    expect(config?.extendData?.series.prixEntree).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(config?.shortName).toMatch(/ …$/);
  });
});
