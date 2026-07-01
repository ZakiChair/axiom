/**
 * Fige les conventions buy/sell (côté agresseur/taker) des 3 adaptateurs qui alimentent
 * CVD + footprint (orderflow.ts). Les trois sont différentes et NON interchangeables :
 *  - Binance  : inverse sur `isBuyerMaker` (m).
 *  - Kraken   : mappage DIRECT (déjà le côté agresseur).
 *  - Coinbase : inverse sur le côté MAKER.
 * Une régression de signe sur l'une des trois inverserait silencieusement le CVD/footprint
 * affiché sans casser la compilation ni aucun autre test — d'où ce test dédié.
 */
import { describe, expect, it } from "vitest";
import { aggTradeToTrade, type BinanceAggTrade } from "./binance";
import { krakenWsTradeToTrade, type KrakenWsTrade } from "./kraken";
import { coinbaseWsTradeToTrade, type CoinbaseWsTrade } from "./coinbase";

describe("aggTradeToTrade (Binance)", () => {
  it("m=true (acheteur maker) => agresseur vendeur => side=sell", () => {
    const trade: BinanceAggTrade = { e: "aggTrade", E: 1, s: "BTCUSDT", a: 1, p: "100", q: "1", T: 123, m: true };
    expect(aggTradeToTrade(trade).side).toBe("sell");
  });

  it("m=false (vendeur maker) => agresseur acheteur => side=buy", () => {
    const trade: BinanceAggTrade = { e: "aggTrade", E: 1, s: "BTCUSDT", a: 1, p: "100", q: "1", T: 123, m: false };
    expect(aggTradeToTrade(trade).side).toBe("buy");
  });
});

describe("krakenWsTradeToTrade (Kraken)", () => {
  it("side=buy (déjà l'agresseur) => mappage direct => side=buy", () => {
    const trade: KrakenWsTrade = {
      symbol: "BTC/USD",
      side: "buy",
      price: 100,
      qty: 1,
      ord_type: "market",
      trade_id: 1,
      timestamp: "2024-01-01T00:00:00Z",
    };
    expect(krakenWsTradeToTrade(trade).side).toBe("buy");
  });

  it("side=sell (déjà l'agresseur) => mappage direct => side=sell", () => {
    const trade: KrakenWsTrade = {
      symbol: "BTC/USD",
      side: "sell",
      price: 100,
      qty: 1,
      ord_type: "market",
      trade_id: 1,
      timestamp: "2024-01-01T00:00:00Z",
    };
    expect(krakenWsTradeToTrade(trade).side).toBe("sell");
  });
});

describe("coinbaseWsTradeToTrade (Coinbase)", () => {
  it("side=BUY (maker acheteur) => agresseur vendeur => side=sell", () => {
    const trade: CoinbaseWsTrade = {
      trade_id: "1",
      product_id: "BTC-USD",
      price: "100",
      size: "1",
      side: "BUY",
      time: "2024-01-01T00:00:00Z",
    };
    expect(coinbaseWsTradeToTrade(trade).side).toBe("sell");
  });

  it("side=SELL (maker vendeur) => agresseur acheteur => side=buy", () => {
    const trade: CoinbaseWsTrade = {
      trade_id: "1",
      product_id: "BTC-USD",
      price: "100",
      size: "1",
      side: "SELL",
      time: "2024-01-01T00:00:00Z",
    };
    expect(coinbaseWsTradeToTrade(trade).side).toBe("buy");
  });
});
