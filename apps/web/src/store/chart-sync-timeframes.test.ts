import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExchangeId } from "@axiom/types";
import { chartLayoutStore } from "./chart-layout";
import { demarrerSyncTimeframes } from "./chart-sync-timeframes";
import { marketIdentity, marketStore } from "./market";
import { replayStore } from "./replay";

let stop: (() => void) | undefined;

beforeEach(() => {
  replayStore.setState({ active: false, identityTransition: false, slot: 0, returnMarket: null });
  marketStore.getState().setMarket({ exchange: "binance", symbol: "BTCUSDT", timeframe: "1m" });
  chartLayoutStore.setState({
    layout: "2x2", focus: 0, linked: false,
    syncTimeframe: false, syncViewport: false, syncCrosshair: true,
    slots: [
      { exchange: "binance", symbol: "ETHUSDT", timeframe: "5m" },
      { exchange: "bybit", symbol: "SOLUSDT", timeframe: "15m" },
      { exchange: "binance", symbol: "BNBUSDT", timeframe: "1h" },
    ],
  });
});

afterEach(() => {
  stop?.();
  stop = undefined;
  replayStore.setState({ active: false, identityTransition: false, returnMarket: null });
});

function timeframes() {
  return [marketStore.getState().timeframe, ...chartLayoutStore.getState().slots.map((s) => s.timeframe)];
}

describe("synchronisation des unités de temps", () => {
  it("reste inactive par défaut", () => {
    stop = demarrerSyncTimeframes();
    marketStore.getState().setTimeframe("4h");
    expect(timeframes()).toEqual(["4h", "5m", "15m", "1h"]);
  });

  it("aligne depuis le focus à l'activation en conservant les actifs et les sources", () => {
    chartLayoutStore.getState().setFocus(2);
    stop = demarrerSyncTimeframes();
    chartLayoutStore.getState().setSyncOption("syncTimeframe", true);
    expect(marketIdentity(marketStore.getState())).toEqual({
      exchange: "binance", symbol: "BTCUSDT", timeframe: "15m",
    });
    expect(chartLayoutStore.getState().slots).toEqual([
      { exchange: "binance", symbol: "ETHUSDT", timeframe: "15m" },
      { exchange: "bybit", symbol: "SOLUSDT", timeframe: "15m" },
      { exchange: "binance", symbol: "BNBUSDT", timeframe: "15m" },
    ]);
  });

  it("aligne une préférence déjà active au montage", () => {
    chartLayoutStore.setState({ syncTimeframe: true, focus: 1 });
    stop = demarrerSyncTimeframes();
    expect(timeframes()).toEqual(["5m", "5m", "5m", "5m"]);
  });

  it("propage depuis le maître puis un secondaire, sans rebond ni invalidation identique", () => {
    stop = demarrerSyncTimeframes();
    chartLayoutStore.getState().setSyncOption("syncTimeframe", true);
    marketStore.getState().setTimeframe("4h");
    expect(timeframes()).toEqual(["4h", "4h", "4h", "4h"]);

    const requestId = marketStore.getState().dataLoad.requestId;
    chartLayoutStore.getState().setSlotTimeframe(3, "1d");
    expect(timeframes()).toEqual(["1d", "1d", "1d", "1d"]);
    expect(marketStore.getState().dataLoad.requestId).toBe(requestId + 1);

    const slots = chartLayoutStore.getState().slots;
    const identity = marketStore.getState();
    marketStore.getState().setTimeframe("1d");
    chartLayoutStore.getState().setFocus(2);
    expect(chartLayoutStore.getState().slots).toBe(slots);
    expect(marketStore.getState()).toBe(identity);
  });

  it("exclut les slots masqués comme cibles et comme émetteurs", () => {
    chartLayoutStore.getState().setLayout("2h");
    stop = demarrerSyncTimeframes();
    chartLayoutStore.getState().setSyncOption("syncTimeframe", true);
    marketStore.getState().setTimeframe("4h");
    expect(timeframes()).toEqual(["4h", "4h", "15m", "1h"]);
    chartLayoutStore.getState().setSlotTimeframe(3, "1w");
    expect(timeframes()).toEqual(["4h", "4h", "15m", "1w"]);
  });

  it("aligne les nouveaux slots depuis l'ancien focus visible, même si le focus change avec la grille", () => {
    chartLayoutStore.setState({ layout: "2h", focus: 1 });
    stop = demarrerSyncTimeframes();
    chartLayoutStore.getState().setSyncOption("syncTimeframe", true);
    chartLayoutStore.setState({ layout: "2x2", focus: 3 });
    expect(timeframes()).toEqual(["5m", "5m", "5m", "5m"]);
  });

  it("garde l'unité d'une source incompatible sans la substituer à celle des autres", () => {
    chartLayoutStore.getState().setSlotMarket(2, {
      exchange: "synthetic", symbol: "TOTAL", timeframe: "1d",
    });
    stop = demarrerSyncTimeframes();
    chartLayoutStore.getState().setSyncOption("syncTimeframe", true);
    marketStore.getState().setTimeframe("5m");
    expect(timeframes()).toEqual(["5m", "5m", "1d", "5m"]);
    expect(chartLayoutStore.getState().slots[1]).toEqual({
      exchange: "synthetic", symbol: "TOTAL", timeframe: "1d",
    });
    chartLayoutStore.getState().setFocus(2);
    expect(timeframes()).toEqual(["5m", "5m", "1d", "5m"]);
  });

  it("garde aussi l'unité incompatible du maître lors d'une propagation secondaire", () => {
    marketStore.getState().setMarket({ exchange: "kraken", symbol: "BTCUSD", timeframe: "1h" });
    stop = demarrerSyncTimeframes();
    chartLayoutStore.getState().setSyncOption("syncTimeframe", true);
    chartLayoutStore.getState().setSlotTimeframe(1, "3d");
    expect(timeframes()).toEqual(["1h", "3d", "1h", "3d"]);
  });

  it("réintègre uniquement le maître quand sa nouvelle source accepte l'unité des vues live", () => {
    chartLayoutStore.getState().setLayout("2h");
    marketStore.getState().setMarket({ exchange: "kraken", symbol: "BTCUSD", timeframe: "1h" });
    stop = demarrerSyncTimeframes();
    chartLayoutStore.getState().setSyncOption("syncTimeframe", true);
    chartLayoutStore.getState().setSlotTimeframe(1, "3d");
    const slots = chartLayoutStore.getState().slots;

    marketStore.getState().setMarket({ exchange: "binance", symbol: "BTCUSDT", timeframe: "1h" });

    expect(marketIdentity(marketStore.getState())).toEqual({
      exchange: "binance", symbol: "BTCUSDT", timeframe: "3d",
    });
    expect(chartLayoutStore.getState().slots).toBe(slots);
  });

  it.each<{ exchange: ExchangeId; symbol: string }>([
    { exchange: "binance", symbol: "ETHUSDT" },
    { exchange: "synthetic", symbol: "binance:ETHUSDT|/|binance:BTCUSDT" },
  ])("réintègre le secondaire devenu compatible ($exchange), sans invalider les cours de la source", (identity) => {
    chartLayoutStore.getState().setSlotMarket(2, {
      exchange: "synthetic", symbol: "TOTAL", timeframe: "1d",
    });
    stop = demarrerSyncTimeframes();
    chartLayoutStore.getState().setSyncOption("syncTimeframe", true);
    marketStore.getState().setTimeframe("5m");
    marketStore.getState().setCandles([
      { time: 1_700_000_000_000, open: 100, high: 103, low: 99, close: 102, volume: 20 },
    ]);
    const source = marketStore.getState();

    chartLayoutStore.getState().setSlotMarket(2, { ...identity, timeframe: "1d" });

    expect(timeframes()).toEqual(["5m", "5m", "5m", "5m"]);
    expect(chartLayoutStore.getState().slots[1]).toEqual({ ...identity, timeframe: "5m" });
    expect(marketStore.getState()).toBe(source);
  });

  it("garde l'unité d'une nouvelle identité toujours incompatible", () => {
    chartLayoutStore.getState().setSlotMarket(2, {
      exchange: "synthetic", symbol: "TOTAL", timeframe: "1d",
    });
    stop = demarrerSyncTimeframes();
    chartLayoutStore.getState().setSyncOption("syncTimeframe", true);
    marketStore.getState().setTimeframe("5m");
    const source = marketStore.getState();

    chartLayoutStore.getState().setSlotSymbol(2, "TOTAL2");

    expect(timeframes()).toEqual(["5m", "5m", "1d", "5m"]);
    expect(chartLayoutStore.getState().slots[1].symbol).toBe("TOTAL2");
    expect(marketStore.getState()).toBe(source);
  });

  it("reprend la dernière unité partagée au retour compatible malgré un maître incompatible au focus", () => {
    marketStore.getState().setMarket({ exchange: "kraken", symbol: "BTCUSD", timeframe: "1h" });
    chartLayoutStore.getState().setSlotMarket(2, {
      exchange: "kraken", symbol: "SOLUSD", timeframe: "1h",
    });
    stop = demarrerSyncTimeframes();
    chartLayoutStore.getState().setSyncOption("syncTimeframe", true);
    chartLayoutStore.getState().setSlotTimeframe(1, "3d");
    const master = marketStore.getState();

    chartLayoutStore.getState().setSlotMarket(2, {
      exchange: "binance", symbol: "SOLUSDT", timeframe: "1h",
    });

    expect(timeframes()).toEqual(["1h", "3d", "3d", "3d"]);
    expect(marketStore.getState()).toBe(master);
  });

  it("propage l'unité explicite choisie avec une nouvelle source", () => {
    chartLayoutStore.getState().setSlotMarket(2, {
      exchange: "synthetic", symbol: "TOTAL", timeframe: "1d",
    });
    stop = demarrerSyncTimeframes();
    chartLayoutStore.getState().setSyncOption("syncTimeframe", true);
    marketStore.getState().setTimeframe("5m");

    chartLayoutStore.getState().setSlotMarket(2, {
      exchange: "binance", symbol: "ETHUSDT", timeframe: "1h",
    });

    expect(timeframes()).toEqual(["1h", "1h", "1h", "1h"]);
  });

  it("exclut le focus en replay de l'activation et préserve sa lecture pendant les changements live", () => {
    chartLayoutStore.setState({ focus: 1 });
    replayStore.setState({ active: true, slot: 1, symbole: "ETHUSDT", tf: "5m" });
    stop = demarrerSyncTimeframes();
    chartLayoutStore.getState().setSyncOption("syncTimeframe", true);
    marketStore.getState().setTimeframe("4h");
    expect(timeframes()).toEqual(["4h", "5m", "4h", "4h"]);
    expect(replayStore.getState().active).toBe(true);
  });

  it("ne propage pas les transitions d'entrée et de sortie du replay", () => {
    stop = demarrerSyncTimeframes();
    chartLayoutStore.getState().setSyncOption("syncTimeframe", true);
    replayStore.setState({ identityTransition: true, slot: 0 });
    marketStore.getState().setTimeframe("1h");
    expect(timeframes()).toEqual(["1h", "1m", "1m", "1m"]);
    replayStore.setState({ identityTransition: true, slot: 2 });
    chartLayoutStore.getState().setSlotTimeframe(2, "4h");
    expect(timeframes()).toEqual(["1h", "1m", "4h", "1m"]);
  });

  it.each([0, 1])("réintègre le slot %i à l'unité live après replay.stop sans propager son ancienne unité", (slot) => {
    stop = demarrerSyncTimeframes();
    chartLayoutStore.getState().setSyncOption("syncTimeframe", true);
    chartLayoutStore.getState().setFocus(slot);
    const returnMarket = slot === 0
      ? marketIdentity(marketStore.getState())
      : chartLayoutStore.getState().slots[slot - 1]!;
    replayStore.setState({ active: true, slot, symbole: returnMarket.symbol, tf: "1m", returnMarket });
    if (slot === 0) chartLayoutStore.getState().setSlotTimeframe(1, "4h");
    else marketStore.getState().setTimeframe("4h");
    expect(replayStore.getState().active).toBe(true);

    replayStore.getState().stop();

    expect(timeframes()).toEqual(["4h", "4h", "4h", "4h"]);
    expect(replayStore.getState().active).toBe(false);
    const returned = slot === 0
      ? marketIdentity(marketStore.getState())
      : chartLayoutStore.getState().slots[slot - 1];
    expect(returned).toEqual({ ...returnMarket, timeframe: "4h" });
  });

  it("préserve l'unité choisie par l'utilisateur quand sa sélection quitte le replay", () => {
    stop = demarrerSyncTimeframes();
    chartLayoutStore.getState().setSyncOption("syncTimeframe", true);
    replayStore.setState({
      active: true, slot: 1, symbole: "ETHUSDT", tf: "1m",
      returnMarket: chartLayoutStore.getState().slots[0],
    });

    chartLayoutStore.getState().setSlotTimeframe(1, "5m");

    expect(replayStore.getState().active).toBe(false);
    expect(timeframes()).toEqual(["5m", "5m", "5m", "5m"]);
  });

  it("reprend la dernière unité partagée à la sortie replay malgré un maître incompatible au focus", () => {
    marketStore.getState().setMarket({ exchange: "kraken", symbol: "BTCUSD", timeframe: "1h" });
    chartLayoutStore.getState().setSlotMarket(2, {
      exchange: "binance", symbol: "SOLUSDT", timeframe: "1h",
    });
    stop = demarrerSyncTimeframes();
    chartLayoutStore.getState().setSyncOption("syncTimeframe", true);
    replayStore.setState({
      active: true, slot: 2, symbole: "SOLUSDT", tf: "1h",
      returnMarket: chartLayoutStore.getState().slots[1],
    });
    chartLayoutStore.getState().setSlotTimeframe(1, "3d");
    const master = marketStore.getState();

    replayStore.getState().stop();

    expect(timeframes()).toEqual(["1h", "3d", "3d", "3d"]);
    expect(marketStore.getState()).toBe(master);
  });

  it.each(["désactivation", "nettoyage"])("ne réintègre plus le replay après %s", (arret) => {
    stop = demarrerSyncTimeframes();
    chartLayoutStore.getState().setSyncOption("syncTimeframe", true);
    replayStore.setState({
      active: true, slot: 1, symbole: "ETHUSDT", tf: "1m",
      returnMarket: chartLayoutStore.getState().slots[0],
    });
    marketStore.getState().setTimeframe("4h");
    if (arret === "désactivation") chartLayoutStore.getState().setSyncOption("syncTimeframe", false);
    else stop();

    replayStore.getState().stop();

    expect(timeframes()).toEqual(["4h", "1m", "4h", "4h"]);
  });

  it("arrête les propagations après désactivation puis après nettoyage", () => {
    stop = demarrerSyncTimeframes();
    chartLayoutStore.getState().setSyncOption("syncTimeframe", true);
    chartLayoutStore.getState().setSyncOption("syncTimeframe", false);
    marketStore.getState().setTimeframe("1h");
    chartLayoutStore.getState().setSlotTimeframe(1, "5m");
    expect(timeframes()).toEqual(["1h", "5m", "1m", "1m"]);
    chartLayoutStore.getState().setSyncOption("syncTimeframe", true);
    stop();
    marketStore.getState().setTimeframe("1d");
    chartLayoutStore.getState().setSlotTimeframe(2, "4h");
    expect(timeframes()).toEqual(["1d", "1h", "4h", "1h"]);
  });
});
