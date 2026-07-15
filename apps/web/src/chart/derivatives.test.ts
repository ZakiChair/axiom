import { afterEach, describe, it, expect, vi } from "vitest";
import type { Chart } from "klinecharts";
import { DerivativesChartController, forwardFillByTime } from "./derivatives";
import { coinalyzeProvider } from "../data/coinalyze";
import { derivativesChartStore } from "../store/derivatives-chart";
import { createMarketStore, marketStore } from "../store/market";

vi.mock("klinecharts", () => ({
  IndicatorSeries: { Normal: "normal" },
  registerIndicator: vi.fn(),
}));

const h = 60 * 60 * 1000;

describe("forwardFillByTime (sous-panes dérivés)", () => {
  it("forward-fill la dernière valeur connue ≤ open time de chaque bougie", () => {
    const candles = [{ time: 2 * h }, { time: 3 * h }, { time: 4 * h }];
    const series = [
      { time: 1 * h, value: 6.0e9 },
      { time: 3 * h, value: 6.2e9 },
    ];
    expect(forwardFillByTime(candles, series)).toEqual({
      [2 * h]: 6.0e9,
      [3 * h]: 6.2e9,
      [4 * h]: 6.2e9,
    });
  });

  it("un point unique s'étale sur toute la fenêtre visible", () => {
    const candles = [{ time: 2 * h }, { time: 3 * h }];
    expect(forwardFillByTime(candles, [{ time: 4 * h, value: 0.01 }])).toEqual({
      [2 * h]: 0.01,
      [3 * h]: 0.01,
    });
  });

  it("aucune valeur AVANT le premier point de série (pas d'extrapolation en arrière)", () => {
    const candles = [{ time: 1 * h }, { time: 5 * h }];
    const series = [{ time: 3 * h, value: 42 }, { time: 4 * h, value: 43 }];
    // La bougie 1h précède toute donnée → absente ; la bougie 5h reçoit le dernier point.
    expect(forwardFillByTime(candles, series)).toEqual({ [5 * h]: 43 });
  });

  it("renvoie {} pour des entrées vides", () => {
    expect(forwardFillByTime([], [{ time: 1, value: 1 }])).toEqual({});
    expect(forwardFillByTime([{ time: 1 }], [])).toEqual({});
  });
});

afterEach(() => {
  derivativesChartStore.setState({ oi: false, funding: false });
  marketStore.getState().setCandles([]);
  vi.restoreAllMocks();
});

describe("DerivativesChartController — isolation multi-slot", () => {
  it("lit et observe uniquement le store marché injecté", async () => {
    const local = createMarketStore({ symbol: "SLOTTESTUSDT", timeframe: "1h" });
    local.getState().setCandles([
      { time: 2 * h, open: 1, high: 2, low: 1, close: 2, volume: 1 },
      { time: 3 * h, open: 2, high: 3, low: 2, close: 3, volume: 1 },
    ]);
    vi.spyOn(coinalyzeProvider, "fetchOpenInterestHistory").mockResolvedValue([
      { time: h, symbol: "SLOTTESTUSDT", oi: 1, oiUsd: 100 },
      { time: 3 * h, symbol: "SLOTTESTUSDT", oi: 2, oiUsd: 200 },
    ]);
    derivativesChartStore.setState({ oi: true, funding: false });

    const chart = {
      createIndicator: vi.fn(() => "slot-oi-pane"),
      overrideIndicator: vi.fn(),
      removeIndicator: vi.fn(),
    } as unknown as Chart;
    const controller = new DerivativesChartController(chart, "SLOTTESTUSDT", local);

    await vi.waitFor(() => expect(chart.createIndicator).toHaveBeenCalledTimes(1));
    const overridesBeforeGlobalTick = vi.mocked(chart.overrideIndicator).mock.calls.length;

    // Une mutation du maître ne doit plus réveiller/recalculer le slot secondaire.
    marketStore.getState().setCandles([
      { time: 99 * h, open: 9, high: 9, low: 9, close: 9, volume: 1 },
    ]);
    expect(chart.overrideIndicator).toHaveBeenCalledTimes(overridesBeforeGlobalTick);

    local.getState().setCandles([
      { time: 2 * h, open: 1, high: 2, low: 1, close: 2, volume: 1 },
      { time: 3 * h, open: 2, high: 3, low: 2, close: 3, volume: 1 },
      { time: 4 * h, open: 3, high: 4, low: 3, close: 4, volume: 1 },
    ]);
    expect(chart.overrideIndicator).toHaveBeenCalledTimes(overridesBeforeGlobalTick + 1);
    expect(chart.overrideIndicator).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: "AXIOM_DERIV_OI",
        extendData: { valueByTime: { [2 * h]: 100, [3 * h]: 200, [4 * h]: 200 } },
      }),
      "slot-oi-pane",
    );

    controller.dispose();
  });
});
