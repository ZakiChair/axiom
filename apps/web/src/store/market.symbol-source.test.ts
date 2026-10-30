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

  it("reste sur synthetic pour une capitalisation autonome", () => {
    const store = createMarketStore({ exchange: "synthetic", symbol: ETH_BTC, timeframe: "1d" });

    store.getState().setSymbol("TOTAL2");

    expect(store.getState().exchange).toBe("synthetic");
    expect(store.getState().symbol).toBe("TOTAL2");
  });

  it("route une saisie directe TOTAL ou mcap vers synthetic en 1d", () => {
    const store = createMarketStore({ exchange: "binance", symbol: "BTCUSDT", timeframe: "1m" });

    store.getState().setSymbol("TOTAL");
    expect(store.getState()).toMatchObject({ exchange: "synthetic", symbol: "TOTAL", timeframe: "1d" });

    store.setState({ exchange: "kraken", symbol: "ETHUSD", timeframe: "1h" });
    store.getState().setSymbol("mcap:TOTAL2|/|binance:ETHUSDT");
    expect(store.getState()).toMatchObject({
      exchange: "synthetic",
      symbol: "mcap:TOTAL2|/|binance:ETHUSDT",
      timeframe: "1d",
    });
  });

  it("quitte un ratio mcap vers TOTAL mais retombe sur Binance pour un ticker normal", () => {
    const ratio = "mcap:TOTAL3|/|binance:BTCUSDT";
    const store = createMarketStore({ exchange: "synthetic", symbol: ratio, timeframe: "1d" });

    store.getState().setSymbol("TOTAL3");
    expect(store.getState().exchange).toBe("synthetic");

    store.setState({ exchange: "synthetic", symbol: ratio });
    store.getState().setSymbol("SOLUSDT");
    expect(store.getState().exchange).toBe("binance");
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

describe("setSymbol — alias pointé d'une série autonome (jamais Twelve Data)", () => {
  it.each(["USDT.D", "usdt.d", " USDC.D ", "DAI.D", "USDT.D+USDC.D+DAI.D"])(
    "%j ouvre STABLE.D en synthetic, en 1d (Entrée sans résultat, watchlist, ↑/↓, ⌘K)",
    (saisie) => {
      for (const init of [{ exchange: "binance", symbol: "BTCUSDT" }, { exchange: "twelvedata", symbol: "SPY" }] as const) {
        const store = createMarketStore({ ...init, timeframe: "1h" });
        store.getState().setSymbol(saisie);
        const { exchange, symbol, timeframe } = store.getState();
        expect({ exchange, symbol, timeframe }, `${saisie} depuis ${init.symbol}`).toEqual({
          exchange: "synthetic",
          symbol: "STABLE.D",
          timeframe: "1d",
        });
      }
    },
  );

  it("BRK.B, EUR/USD, SPY, BTCUSDT et HYPE-PERP gardent leur routage", () => {
    const attendus = [
      ["brk.b", "twelvedata", "BRK.B"],
      ["EUR/USD", "twelvedata", "EUR/USD"],
      ["SPY", "twelvedata", "SPY"],
      ["btcusdt", "binance", "BTCUSDT"],
      ["HYPE-PERP", "hyperliquid", "HYPE-PERP"],
    ] as const;
    for (const [saisie, exchange, symbol] of attendus) {
      const store = createMarketStore({ exchange: "binance", symbol: "ETHUSDT", timeframe: "1h" });
      store.getState().setSymbol(saisie);
      expect({ exchange: store.getState().exchange, symbol: store.getState().symbol, timeframe: store.getState().timeframe }, saisie)
        .toEqual({ exchange, symbol, timeframe: "1h" });
    }
  });
});

// Source EXPLICITE d'avant le correctif ({twelvedata, USDT.D}) : workspace enregistré, message d'une
// autre fenêtre, « Voir sur le chart ». setMarket résout le COUPLE (jamais {twelvedata, STABLE.D}) et
// garde l'unité, que le graphe ramène ensuite à une unité servie (timeframeProche, comme preparerIdentite).
describe("setMarket — série désignée sur une source Twelve Data explicite", () => {
  it.each(["USDT.D", "usdt.d", "USDT.D+USDC.D+DAI.D", "DAI.D", "STABLE.D"])(
    "{twelvedata, %j} → {synthetic, STABLE.D}, unité gardée",
    (saisie) => {
      const store = createMarketStore({ exchange: "binance", symbol: "BTCUSDT", timeframe: "1m" });
      store.getState().setMarket({ exchange: "twelvedata", symbol: saisie, timeframe: "1h" });
      const { exchange, symbol, timeframe } = store.getState();
      expect({ exchange, symbol, timeframe }).toEqual({ exchange: "synthetic", symbol: "STABLE.D", timeframe: "1h" });
    },
  );

  it("setExchange('twelvedata') sur STABLE.D reste sur la série, sans invalider le cycle", () => {
    const store = createMarketStore({ exchange: "synthetic", symbol: "STABLE.D", timeframe: "1d" });
    const avant = store.getState().dataLoad.requestId;
    store.getState().setExchange("twelvedata");
    expect(store.getState()).toMatchObject({ exchange: "synthetic", symbol: "STABLE.D", timeframe: "1d" });
    expect(store.getState().dataLoad.requestId).toBe(avant);
  });

  it("témoins : la source explicite gagne pour tout le reste (TradFi, perps, maître kraken+TOTAL toléré)", () => {
    const temoins = [
      ["twelvedata", "BRK.B"],
      ["twelvedata", "EUR/USD"],
      ["twelvedata", "SPY"],
      ["binance", "BTCUSDT"],
      ["hyperliquid", "BTCUSDT"],
      ["kraken", "TOTAL"],
    ] as const;
    for (const [exchange, symbol] of temoins) {
      const store = createMarketStore({ exchange: "binance", symbol: "ETHUSDT", timeframe: "1h" });
      store.getState().setMarket({ exchange, symbol, timeframe: "4h" });
      const etat = store.getState();
      expect({ exchange: etat.exchange, symbol: etat.symbol, timeframe: etat.timeframe }, `${exchange}:${symbol}`)
        .toEqual({ exchange, symbol, timeframe: "4h" });
    }
  });
});
