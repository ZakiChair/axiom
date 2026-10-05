import { afterEach, describe, it, expect, vi } from "vitest";
import type { Chart } from "klinecharts";
import {
  _viderCachesPanesDerives,
  DerivativesChartController,
  forwardFillByTime,
} from "./derivatives";
import { coinalyzeProvider } from "../data/coinalyze";
import { _reinitialiserCatalogueMarchesPerp } from "../data/marchesPerp";
import { derivativesChartStore } from "../store/derivatives-chart";
import { derivativesUiStore } from "../store/derivatives-ui";
import { createMarketStore, marketStore } from "../store/market";

vi.mock("klinecharts", () => ({
  IndicatorSeries: { Normal: "normal" },
  registerIndicator: vi.fn(),
}));

// La résolution de marché n'est PAS mockée : les tests bouchonnent `fetch` pour
// servir un vrai catalogue `future-markets` (le module est importé dynamiquement
// par le contrôleur — un vi.mock ne tient pas de façon fiable à travers les
// résolutions asynchrones). `fetchOpenInterestHistory` reste espionné.

/** Ligne de catalogue `future-markets` minimale (champs consommés). */
function ligneCatalogue(
  symbol: string,
  exchange: string,
  symbolOnExchange: string,
  base: string,
  quote: string,
): unknown {
  return {
    symbol,
    exchange,
    symbol_on_exchange: symbolOnExchange,
    base_asset: base,
    quote_asset: quote,
    margined: "STABLE",
    is_perpetual: true,
    has_long_short_ratio_data: true,
  };
}

/** Bouchonne `fetch` : sert `lignes` pour future-markets, 503 ailleurs. */
function stubCatalogue(lignes: unknown[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).includes("/coinalyzeapi/v1/future-markets")
        ? new Response(JSON.stringify(lignes))
        : new Response("bouchonné", { status: 503 }),
    ),
  );
}

/** Catalogue PUMP à deux places (Binance + Bybit), comme le 5/10/2026. */
function cataloguePump(): unknown[] {
  return [
    ligneCatalogue("PUMPUSDT_PERP.A", "A", "PUMPUSDT", "PUMP", "USDT"),
    ligneCatalogue("PUMPFUNUSDT.6", "6", "PUMPFUNUSDT", "PUMP", "USDT"),
  ];
}

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
  derivativesUiStore.setState({ placesPerp: {} });
  marketStore.getState().setCandles([]);
  _viderCachesPanesDerives();
  _reinitialiserCatalogueMarchesPerp();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DerivativesChartController — isolation multi-slot", () => {
  it("lit et observe uniquement le store marché injecté", async () => {
    // Catalogue bouchonné : marché Binance pour le symbole du slot.
    stubCatalogue([
      ligneCatalogue("SLOTTESTUSDT_PERP.A", "A", "SLOTTESTUSDT", "SLOTTEST", "USDT"),
    ]);
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

// ───────── Marché multi-places (demande du 5 octobre 2026) ─────────
describe("DerivativesChartController — marché perp résolu par actif", () => {
  function chartEtMarche() {
    stubCatalogue(cataloguePump());
    const local = createMarketStore({ symbol: "PUMPUSDT", timeframe: "1h" });
    local.getState().setCandles([
      { time: 2 * h, open: 1, high: 2, low: 1, close: 2, volume: 1 },
      { time: 3 * h, open: 2, high: 3, low: 2, close: 3, volume: 1 },
      { time: 4 * h, open: 3, high: 4, low: 3, close: 4, volume: 1 },
    ]);
    const chart = {
      createIndicator: vi.fn(() => "pane-oi"),
      overrideIndicator: vi.fn(),
      removeIndicator: vi.fn(),
    } as unknown as Chart;
    return { local, chart };
  }

  it("marché non Binance → fetchOpenInterestHistory sur l'id Coinalyze, SANS repli Binance", async () => {
    const { local, chart } = chartEtMarche();
    derivativesUiStore.setState({ placesPerp: { PUMP: "bybit" } });
    const spy = vi
      .spyOn(coinalyzeProvider, "fetchOpenInterestHistory")
      .mockResolvedValue([
        { time: 2 * h, symbol: "PUMPFUNUSDT.6", oi: NaN, oiUsd: 777 },
      ]);
    derivativesChartStore.setState({ oi: true, funding: false });

    const controller = new DerivativesChartController(chart, "PUMPUSDT", local);
    await vi.waitFor(() => expect(chart.createIndicator).toHaveBeenCalledTimes(1));
    // Appel direct avec l'id Coinalyze du marché Bybit — pas de histOiUsdAvecRepli.
    expect(spy).toHaveBeenCalledWith("PUMPFUNUSDT.6", "1hour", expect.any(Number));
    controller.dispose();
  });

  it("un choix de place dans DES recharge la série sur le nouveau symbole", async () => {
    const { local, chart } = chartEtMarche();
    const spy = vi
      .spyOn(coinalyzeProvider, "fetchOpenInterestHistory")
      .mockImplementation(async (symbole) => [
        { time: 2 * h, symbol: symbole, oi: NaN, oiUsd: symbole === "PUMPFUNUSDT.6" ? 555 : 111 },
      ]);
    derivativesChartStore.setState({ oi: true, funding: false });

    const controller = new DerivativesChartController(chart, "PUMPUSDT", local);
    // Marché par défaut : Binance (ordre PLACES_PERP), OI via histOiUsdAvecRepli
    // dont le primaire est fetchOpenInterestHistory("PUMPUSDT").
    await vi.waitFor(() => expect(chart.createIndicator).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith("PUMPUSDT", "1hour", expect.any(Number));

    derivativesUiStore.getState().choisirPlacePerp("PUMP", "bybit");
    await vi.waitFor(() =>
      expect(spy).toHaveBeenCalledWith("PUMPFUNUSDT.6", "1hour", expect.any(Number)),
    );
    // Le pane est retiré puis RECRÉÉ sur la nouvelle série (Bybit, 555).
    await vi.waitFor(() => expect(chart.createIndicator).toHaveBeenCalledTimes(2));
    expect(chart.createIndicator).toHaveBeenLastCalledWith(
      expect.objectContaining({
        extendData: { valueByTime: { [2 * h]: 555, [3 * h]: 555, [4 * h]: 555 } },
      }),
      false,
      { id: "axiom_deriv_oi" },
    );
    controller.dispose();
  });

  it("une réponse arrivée APRÈS un changement de place est ignorée", async () => {
    const { local, chart } = chartEtMarche();
    // Tableau (et non variable nullable) : TS rétrécirait sinon la variable à null
    // après son affectation dans la closure du mock.
    const staleResolve: Array<
      (v: { time: number; symbol: string; oi: number; oiUsd: number }[]) => void
    > = [];
    const spy = vi
      .spyOn(coinalyzeProvider, "fetchOpenInterestHistory")
      .mockImplementation(async (symbole) => {
        if (symbole === "PUMPUSDT") {
          return await new Promise((resolve) => {
            staleResolve.push(resolve);
          });
        }
        return [{ time: 2 * h, symbol: symbole, oi: NaN, oiUsd: 999 }];
      });
    derivativesChartStore.setState({ oi: true, funding: false });

    const controller = new DerivativesChartController(chart, "PUMPUSDT", local);
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith("PUMPUSDT", "1hour", expect.any(Number)));

    // Bascule Bybit AVANT la résolution de la requête Binance encore en vol.
    derivativesUiStore.getState().choisirPlacePerp("PUMP", "bybit");
    staleResolve[0]?.([{ time: 2 * h, symbol: "PUMPUSDT", oi: NaN, oiUsd: 1 }]);
    await vi.waitFor(() => expect(chart.createIndicator).toHaveBeenCalledTimes(1));
    // Le pane créé provient de la série Bybit (999), jamais de la réponse périmée (1).
    const premierArg = vi.mocked(chart.createIndicator).mock.calls[0]?.[0] as
      | { extendData?: { valueByTime: Record<number, number> } }
      | undefined;
    expect(premierArg?.extendData?.valueByTime[2 * h]).toBe(999);
    controller.dispose();
  });
});
