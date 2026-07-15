import { beforeEach, describe, expect, it } from "vitest";
import { chartLayoutStore } from "../store/chart-layout";
import { masterLinkSource, propagerMarche } from "../store/chart-linking";
import { marketIdentity, marketStore } from "../store/market";

beforeEach(() => {
  marketStore.getState().setMarket({ exchange: "binance", symbol: "BTCUSDT", timeframe: "5m" });
  chartLayoutStore.setState({
    layout: "2h",
    focus: 0,
    linked: true,
    slots: [
      {
        exchange: "synthetic",
        symbol: "binance:ETHUSDT|/|twelvedata:GLD",
        timeframe: "1h",
      },
      { exchange: "binance", symbol: "SOLUSDT", timeframe: "1m" },
      { exchange: "binance", symbol: "BNBUSDT", timeframe: "1m" },
    ],
  });
});

describe("ChartGrid — liaison d'identité", () => {
  it("utilise l'identité live capturée quand la liaison est activée pendant un replay maître", () => {
    const replayMarket = { exchange: "binance" as const, symbol: "BTCUSDT", timeframe: "1m" as const };
    const liveMarket = { exchange: "kraken" as const, symbol: "ETHUSD", timeframe: "5m" as const };

    expect(masterLinkSource(replayMarket, { active: true, slot: 0, returnMarket: liveMarket })).toEqual(
      liveMarket,
    );
    expect(masterLinkSource(replayMarket, { active: false, slot: 0, returnMarket: liveMarket })).toEqual(
      replayMarket,
    );
  });

  it("propage atomiquement la source avec un symbole synthétique sans changer sa casse", () => {
    const synthetic = chartLayoutStore.getState().slots[0];

    propagerMarche(1, synthetic);

    expect(marketIdentity(marketStore.getState())).toEqual({
      exchange: "synthetic",
      symbol: "binance:ETHUSDT|/|twelvedata:GLD",
      timeframe: "5m",
    });
  });

  it("ramène aussi un slot synthétique vers une identité de source normale valide", () => {
    propagerMarche(0, marketIdentity(marketStore.getState()));

    expect(chartLayoutStore.getState().slots[0]).toEqual({
      exchange: "binance",
      symbol: "BTCUSDT",
      timeframe: "1h",
    });
  });
});
