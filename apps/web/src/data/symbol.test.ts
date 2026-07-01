import { describe, expect, it } from "vitest";
import { splitSymbol } from "./symbol";

describe("splitSymbol — format concaténé", () => {
  it("découpe avec le suffixe de cotation le plus long en priorité (USDT avant USD)", () => {
    expect(splitSymbol("BTCUSDT", "Test")).toEqual({ base: "BTC", quote: "USDT" });
  });

  it("retombe sur un suffixe plus court si le plus long ne correspond pas", () => {
    expect(splitSymbol("BTCUSD", "Test")).toEqual({ base: "BTC", quote: "USD" });
  });

  it("priorise TUSD sur USD (USD est une terminaison de TUSD)", () => {
    // Sans le tri par longueur, "FOOTUSD" serait mal coupé en base "FOOT" / quote "USD".
    expect(splitSymbol("FOOTUSD", "Test")).toEqual({ base: "FOO", quote: "TUSD" });
  });

  it("priorise EURC sur EUR", () => {
    expect(splitSymbol("BTCEURC", "Test")).toEqual({ base: "BTC", quote: "EURC" });
  });

  it("reconnaît les cotations fiat étendues du catalogue Kraken (JPY, CHF, CAD, AUD, GBP)", () => {
    // Régression 0.4a : BTCJPY & consorts levaient une erreur au chargement du catalogue.
    expect(splitSymbol("BTCJPY", "Kraken")).toEqual({ base: "BTC", quote: "JPY" });
    expect(splitSymbol("ETHCHF", "Kraken")).toEqual({ base: "ETH", quote: "CHF" });
    expect(splitSymbol("ADACAD", "Kraken")).toEqual({ base: "ADA", quote: "CAD" });
    expect(splitSymbol("SOLAUD", "Kraken")).toEqual({ base: "SOL", quote: "AUD" });
    expect(splitSymbol("XRPGBP", "Kraken")).toEqual({ base: "XRP", quote: "GBP" });
  });

  it("reconnaît les cotations stablecoin étendues (USDE, EURC, DAI) et fiat TRY/BRL", () => {
    expect(splitSymbol("BTCUSDE", "Kraken")).toEqual({ base: "BTC", quote: "USDE" });
    expect(splitSymbol("ETHDAI", "Kraken")).toEqual({ base: "ETH", quote: "DAI" });
    expect(splitSymbol("BTCTRY", "Kraken")).toEqual({ base: "BTC", quote: "TRY" });
    expect(splitSymbol("USDTBRL", "Kraken")).toEqual({ base: "USDT", quote: "BRL" });
  });

  it("est insensible à la casse", () => {
    expect(splitSymbol("ethusdc", "Test")).toEqual({ base: "ETH", quote: "USDC" });
  });

  it("lève une erreur préfixée par le label de l'exchange si la devise de cotation est inconnue", () => {
    expect(() => splitSymbol("BTCXYZ", "Kraken")).toThrow(/^Kraken:.*BTCXYZ/);
  });
});

describe("splitSymbol — format explicite BASE/QUOTE (slash)", () => {
  it("découpe directement sur le slash sans deviner la cotation", () => {
    // Kraken WS emploie "XBT/USD" ; XBT n'est pas une cotation connue mais reste une base valide.
    expect(splitSymbol("XBT/USD", "Kraken")).toEqual({ base: "XBT", quote: "USD" });
  });

  it("gère un slash avec cotation multi-caractères", () => {
    expect(splitSymbol("BTC/USDT", "Kraken")).toEqual({ base: "BTC", quote: "USDT" });
  });

  it("est insensible à la casse (slash)", () => {
    expect(splitSymbol("eur/usd", "Test")).toEqual({ base: "EUR", quote: "USD" });
  });

  it("lève une erreur si un côté du slash est vide", () => {
    expect(() => splitSymbol("/USD", "Kraken")).toThrow(/invalide/);
    expect(() => splitSymbol("BTC/", "Kraken")).toThrow(/invalide/);
  });
});
