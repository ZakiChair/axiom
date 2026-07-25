/**
 * Cohérence source ⇄ symbole lors d'un changement de SYMBOLE SEUL.
 *
 * La source virtuelle `synthetic` ne sait lire que les symboles SYN encodés : quitter
 * un ratio (÷BTC, presets SYN…) en ne posant QUE le symbole doit aussi quitter la
 * source, sinon l'adaptateur SYN reçoit un ticker normal et le backfill échoue
 * (« Symbole synthétique invalide » → bandeau « Données indisponibles »).
 */
import { describe, expect, it } from "vitest";
import { createMarketStore } from "./market";

const ETH_BTC = "binance:ETHUSDT|/|binance:BTCUSDT";
const SOL_BTC = "binance:SOLUSDT|/|binance:BTCUSDT";

describe("setSymbol — source cohérente avec le symbole", () => {
  it("quitte la source synthetic pour la jambe A quand on pose un ticker normal", () => {
    const store = createMarketStore({ exchange: "synthetic", symbol: ETH_BTC, timeframe: "1w" });

    store.getState().setSymbol("SOLUSDT");

    expect(store.getState().exchange).toBe("binance");
    expect(store.getState().symbol).toBe("SOLUSDT");
    expect(store.getState().timeframe).toBe("1w");
  });

  it("revient à la source de la jambe A, pas à un repli Binance en dur", () => {
    const store = createMarketStore({
      exchange: "synthetic",
      symbol: "kraken:ETHUSD|/|kraken:BTCUSD",
      timeframe: "1h",
    });

    store.getState().setSymbol("SOLUSD");

    expect(store.getState().exchange).toBe("kraken");
    expect(store.getState().symbol).toBe("SOLUSD");
  });

  it("reste sur synthetic quand le nouveau symbole est lui-même un SYN", () => {
    const store = createMarketStore({ exchange: "synthetic", symbol: ETH_BTC });

    store.getState().setSymbol(SOL_BTC);

    expect(store.getState().exchange).toBe("synthetic");
    expect(store.getState().symbol).toBe(SOL_BTC);
  });

  it("préserve la séquence setExchange('synthetic') puis setSymbol(SYN) (constructeur SYN, restauration)", () => {
    const store = createMarketStore({ exchange: "binance", symbol: "BTCUSDT" });

    store.getState().setExchange("synthetic");
    store.getState().setSymbol(ETH_BTC);

    expect(store.getState().exchange).toBe("synthetic");
    expect(store.getState().symbol).toBe(ETH_BTC);
  });

  it("laisse gagner une source explicite posée avant le symbole (watchlist, notes, portefeuille)", () => {
    const store = createMarketStore({ exchange: "synthetic", symbol: ETH_BTC });

    store.getState().setExchange("kraken");
    store.getState().setSymbol("SOLUSD");

    expect(store.getState().exchange).toBe("kraken");
    expect(store.getState().symbol).toBe("SOLUSD");
  });

  it("retombe sur Binance si l'ancien symbole n'était pas un SYN décodable", () => {
    const store = createMarketStore({ exchange: "binance", symbol: "BTCUSDT" });
    store.getState().setExchange("synthetic"); // état incohérent transitoire

    store.getState().setSymbol("SOLUSDT");

    expect(store.getState().exchange).toBe("binance");
    expect(store.getState().symbol).toBe("SOLUSDT");
  });

  it("n'invalide le cycle de données QU'UNE fois (un seul setMarket)", () => {
    const store = createMarketStore({ exchange: "synthetic", symbol: ETH_BTC });
    const avant = store.getState().dataLoad.requestId;

    store.getState().setSymbol("SOLUSDT");

    expect(store.getState().dataLoad.requestId).toBe(avant + 1);
    expect(store.getState().dataLoad.requested).toEqual({
      exchange: "binance",
      symbol: "SOLUSDT",
      timeframe: store.getState().timeframe,
    });
  });

  it("ne touche pas à la source hors contexte synthétique", () => {
    const store = createMarketStore({ exchange: "kraken", symbol: "BTCUSD" });

    store.getState().setSymbol("ethusd");

    expect(store.getState().exchange).toBe("kraken");
    expect(store.getState().symbol).toBe("ETHUSD");
  });
});
