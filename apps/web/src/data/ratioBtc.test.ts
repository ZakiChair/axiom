import { describe, expect, it } from "vitest";
import { estRatioBtc, symboleRatioBtc } from "./ratioBtc";

describe("symboleRatioBtc — cible SYN X/BTC pour le marché courant", () => {
  it("compose le ratio SYN sur binance (réf BTCUSDT)", () => {
    expect(symboleRatioBtc("ETHUSDT", "binance")).toBe("binance:ETHUSDT|/|binance:BTCUSDT");
  });

  it("compose le ratio SYN sur kraken (réf BTCUSD)", () => {
    expect(symboleRatioBtc("SOLUSD", "kraken")).toBe("kraken:SOLUSD|/|kraken:BTCUSD");
  });

  it("compose le ratio SYN sur mexc (réf BTCUSDT)", () => {
    expect(symboleRatioBtc("ETHUSDT", "mexc")).toBe("mexc:ETHUSDT|/|mexc:BTCUSDT");
  });

  it("compose le ratio SYN sur coinbase (réf BTCUSD)", () => {
    expect(symboleRatioBtc("ETHUSD", "coinbase")).toBe("coinbase:ETHUSD|/|coinbase:BTCUSD");
  });

  it("refuse une base déjà BTC", () => {
    expect(symboleRatioBtc("BTCUSDT", "binance")).toBeNull();
  });

  it("refuse un symbole déjà coté en BTC (ETHBTC)", () => {
    expect(symboleRatioBtc("ETHBTC", "binance")).toBeNull();
  });

  it("refuse une source sans réf BTC (twelvedata)", () => {
    expect(symboleRatioBtc("SPY", "twelvedata")).toBeNull();
  });

  it("refuse la source virtuelle synthetic", () => {
    expect(symboleRatioBtc("binance:ETHUSDT|/|binance:BTCUSDT", "synthetic")).toBeNull();
  });

  it("renvoie null (pas de throw) sur un symbole indécoupable", () => {
    expect(symboleRatioBtc("XYZ", "binance")).toBeNull();
  });
});

describe("estRatioBtc — reconnaît un ratio ÷BTC posé par le toggle", () => {
  it("round-trip : la sortie de symboleRatioBtc est reconnue, legA préservée", () => {
    const cible = symboleRatioBtc("ETHUSDT", "binance");
    expect(cible).not.toBeNull();
    const spec = estRatioBtc(cible as string, "synthetic");
    expect(spec).not.toBeNull();
    expect(spec?.legA).toBe("ETHUSDT");
    expect(spec?.exA).toBe("binance");
  });

  it("refuse l'opérateur spread (-)", () => {
    expect(estRatioBtc("binance:ETHUSDT|-|binance:BTCUSDT", "synthetic")).toBeNull();
  });

  it("refuse exB ≠ exA", () => {
    expect(estRatioBtc("binance:ETHUSDT|/|kraken:BTCUSD", "synthetic")).toBeNull();
  });

  it("refuse legB ≠ réf BTC de la source", () => {
    expect(estRatioBtc("binance:ETHUSDT|/|binance:ETHUSDT", "synthetic")).toBeNull();
  });

  it("refuse un exchange autre que synthetic", () => {
    expect(estRatioBtc("binance:ETHUSDT|/|binance:BTCUSDT", "binance")).toBeNull();
  });
});
