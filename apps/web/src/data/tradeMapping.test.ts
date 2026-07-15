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
import { bybitWsTradeToTrade, type BybitWsTrade } from "./bybit";
import { okxWsTradeToTrade, type OkxWsTrade } from "./okx";
import { hlWsTradeToTrade, type HlWsTrade } from "./hyperliquid";

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

describe("bybitWsTradeToTrade (Bybit)", () => {
  const base: BybitWsTrade = { T: 1, s: "BTCUSDT", S: "Buy", v: "1", p: "100" };
  it("S=Buy (agresseur acheteur) => mappage direct => side=buy", () => {
    expect(bybitWsTradeToTrade({ ...base, S: "Buy" }).side).toBe("buy");
  });
  it("S=Sell (agresseur vendeur) => mappage direct => side=sell", () => {
    expect(bybitWsTradeToTrade({ ...base, S: "Sell" }).side).toBe("sell");
  });
});

describe("okxWsTradeToTrade (OKX)", () => {
  const base: OkxWsTrade = { instId: "BTC-USDT", tradeId: "1", px: "100", sz: "1", side: "buy", ts: "1" };
  it("side=buy (déjà l'agresseur) => mappage direct => side=buy", () => {
    expect(okxWsTradeToTrade({ ...base, side: "buy" }).side).toBe("buy");
  });
  it("side=sell (déjà l'agresseur) => mappage direct => side=sell", () => {
    expect(okxWsTradeToTrade({ ...base, side: "sell" }).side).toBe("sell");
  });
});

describe("hlWsTradeToTrade (Hyperliquid)", () => {
  const base: HlWsTrade = { coin: "BTC", side: "B", px: "100", sz: "1", time: 1 };
  it("side=B (agresseur acheteur) => side=buy", () => {
    expect(hlWsTradeToTrade({ ...base, side: "B" }).side).toBe("buy");
  });
  it("side=A (agresseur vendeur/ask) => side=sell", () => {
    expect(hlWsTradeToTrade({ ...base, side: "A" }).side).toBe("sell");
  });
});
