/**
 * Contrat d'intégrité du cycle données marché : une identité demandée ne devient chargée
 * qu'au commit du backfill correspondant, et aucun callback obsolète ne peut repeupler
 * le buffer après un changement symbole/source/timeframe.
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { createMarketStore, marketIdentity } from "./market";

function candle(time: number, close: number): Candle {
  return { time, open: close, high: close, low: close, close, volume: 1 };
}

describe("marketStore — identité demandée / chargée", () => {
  it("ne publie les bougies et l'identité chargée qu'au commit du backfill courant", () => {
    const store = createMarketStore({ exchange: "binance", symbol: "BTCUSDT", timeframe: "1m" });
    const requested = marketIdentity(store.getState());

    const requestId = store.getState().startDataLoad(requested);
    expect(requestId).not.toBeNull();
    expect(store.getState().dataLoad).toMatchObject({
      status: "loading",
      requested,
      loaded: null,
      error: null,
    });
    expect(store.getState().candles).toEqual([]);

    const candles = [candle(1_000, 10), candle(2_000, 11)];
    expect(store.getState().completeDataLoad(requested, requestId ?? -1, candles)).toBe(true);
    expect(store.getState().dataLoad).toMatchObject({ status: "ready", requested, loaded: requested });
    expect(store.getState().candles).toEqual(candles);
  });

  it("invalide synchroniquement l'ancien buffer dès que le symbole change", () => {
    const store = createMarketStore();
    const btc = marketIdentity(store.getState());
    const btcRequest = store.getState().startDataLoad(btc) ?? -1;
    store.getState().completeDataLoad(btc, btcRequest, [candle(1_000, 10)]);

    store.getState().setSymbol("ethusdt");

    expect(store.getState().candles).toEqual([]);
    expect(store.getState().dataLoad).toMatchObject({
      status: "loading",
      requested: { exchange: "binance", symbol: "ETHUSDT", timeframe: "1m" },
      loaded: btc,
    });
  });

  it("invalide aussi le buffer lors d'un changement de source à symbole égal", () => {
    const store = createMarketStore();
    const binance = marketIdentity(store.getState());
    const requestId = store.getState().startDataLoad(binance) ?? -1;
    store.getState().completeDataLoad(binance, requestId, [candle(1_000, 10)]);

    store.getState().setExchange("kraken");

    expect(store.getState().candles).toEqual([]);
    expect(store.getState().dataLoad).toMatchObject({
      status: "loading",
      requested: { exchange: "kraken", symbol: "BTCUSDT", timeframe: "1m" },
      loaded: binance,
    });
  });

  it("bascule une identité complète en une seule invalidation atomique", () => {
    const store = createMarketStore();
    const before = store.getState().dataLoad.requestId;

    store.getState().setMarket({ exchange: "kraken", symbol: "ethusd", timeframe: "5m" });

    expect(marketIdentity(store.getState())).toEqual({
      exchange: "kraken",
      symbol: "ETHUSD",
      timeframe: "5m",
    });
    expect(store.getState().dataLoad).toMatchObject({
      status: "loading",
      requestId: before + 1,
      requested: { exchange: "kraken", symbol: "ETHUSD", timeframe: "5m" },
    });
  });

  it("ignore une réponse tardive de l'ancienne identité", () => {
    const store = createMarketStore();
    const btc = marketIdentity(store.getState());
    const btcRequest = store.getState().startDataLoad(btc) ?? -1;

    store.getState().setSymbol("ETHUSDT");

    expect(store.getState().completeDataLoad(btc, btcRequest, [candle(1_000, 99)])).toBe(false);
    expect(store.getState().symbol).toBe("ETHUSDT");
    expect(store.getState().candles).toEqual([]);
    expect(store.getState().dataLoad.loaded).toBeNull();
  });

  it("distingue deux requêtes successives de même identité (garde anti-ABA)", () => {
    const store = createMarketStore();
    const firstIdentity = marketIdentity(store.getState());
    const firstRequest = store.getState().startDataLoad(firstIdentity) ?? -1;

    store.getState().setSymbol("ETHUSDT");
    store.getState().setSymbol("BTCUSDT");
    const currentIdentity = marketIdentity(store.getState());
    const currentRequest = store.getState().startDataLoad(currentIdentity) ?? -1;

    expect(currentRequest).not.toBe(firstRequest);
    expect(store.getState().completeDataLoad(firstIdentity, firstRequest, [candle(1_000, 99)])).toBe(false);
    expect(store.getState().candles).toEqual([]);
    expect(store.getState().completeDataLoad(currentIdentity, currentRequest, [candle(2_000, 20)])).toBe(true);
    expect(store.getState().candles.map((item) => item.close)).toEqual([20]);
  });

  it("refuse les derniers ticks d'un abonnement devenu obsolète", () => {
    const store = createMarketStore();
    const btc = marketIdentity(store.getState());
    const btcRequest = store.getState().startDataLoad(btc) ?? -1;
    store.getState().completeDataLoad(btc, btcRequest, [candle(1_000, 10)]);

    store.getState().setTimeframe("5m");

    expect(store.getState().upsertCandleFor(btc, btcRequest, candle(2_000, 99))).toBe(false);
    expect(store.getState().candles).toEqual([]);
  });

  it("expose l'erreur courante puis la réinitialise lors d'un retry", () => {
    const store = createMarketStore();
    const requested = marketIdentity(store.getState());
    const failedRequest = store.getState().startDataLoad(requested) ?? -1;

    expect(store.getState().failDataLoad(requested, failedRequest, "Source indisponible")).toBe(true);
    expect(store.getState().dataLoad).toMatchObject({
      status: "error",
      requested,
      loaded: null,
      error: "Source indisponible",
    });

    const retryRequest = store.getState().startDataLoad(requested);
    expect(retryRequest).not.toBe(failedRequest);
    expect(store.getState().dataLoad).toMatchObject({ status: "loading", error: null });
  });
});
