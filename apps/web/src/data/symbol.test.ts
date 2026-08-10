import { describe, expect, it } from "vitest";
import { basePerp, splitSymbol } from "./symbol";

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

describe("basePerp — base normalisée pour un perp USDT", () => {
  it("extrait la base d'un concaténé Binance", () => {
    expect(basePerp("BTCUSDT")).toBe("BTC");
    expect(basePerp("ETHUSDT")).toBe("ETH");
  });

  it("tolère le tiret Coinbase « BTC-USD » (splitSymbol renverrait « BTC- »)", () => {
    // Cause racine du bug LIQEST muet : « BTC-USD » n'était pas normalisé avant le fetch OI.
    expect(basePerp("BTC-USD")).toBe("BTC");
    expect(basePerp("SOL-USDT")).toBe("SOL");
  });

  it("tolère le slash Kraken et mappe XBT → BTC", () => {
    expect(basePerp("XBT/USD")).toBe("BTC");
    expect(basePerp("ETH/USD")).toBe("ETH");
    // LIMITE ASSUMÉE : l'altname REST concaténé « XBTUSD » se termine par « TUSD » (TrueUSD),
    // que QUOTE_ASSETS prend en priorité — il donne donc « XB ». Sans conséquence : le catalogue
    // rétablit BTC (data/pairs.ts KRAKEN_ASSET_ALIAS) et le WS Kraken v2 émet « BTC »/« XBT/USD ».
    expect(basePerp("XBTUSD")).toBe("XB");
  });

  it("est insensible à la casse et aux espaces", () => {
    expect(basePerp("  btc-usd ")).toBe("BTC");
  });

  it("renvoie null sur un symbole synthétique (encodage à barres verticales)", () => {
    expect(basePerp("binance:ETHUSDT|/|binance:BTCUSDT")).toBeNull();
  });

  it("renvoie null quand la base est inextricable", () => {
    expect(basePerp("")).toBeNull();
    expect(basePerp("FOOBAR")).toBeNull(); // aucune cotation reconnue en suffixe
    expect(basePerp("/USD")).toBeNull(); // base vide
  });
});
