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
    // Chez Coinbase, qui ne cote pas TUSD (DOT/USD), USD s'applique.
    expect(splitSymbol("FOOTUSD", "Coinbase")).toEqual({ base: "FOOT", quote: "USD" });
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
    // LIMITE ASSUMÉE sans place : l'altname REST concaténé « XBTUSD » se termine par « TUSD »
    // (TrueUSD), pris en priorité — il donne donc « XB ». Avec la place Kraken, qui ne cote pas
    // TUSD, il redonne XBT → BTC (vérification du 26/09).
    expect(basePerp("XBTUSD")).toBe("XB");
    expect(basePerp("XBTUSD", "kraken")).toBe("BTC");
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

describe("identité perp explicite", () => {
  it("conserve l'actif pour les lecteurs dérivés sans inventer une quote spot", () => {
    expect(basePerp("BTC-PERP")).toBe("BTC");
    expect(basePerp("XBT-PERP")).toBe("BTC");
    expect(basePerp("-PERP")).toBeNull();
  });
});

describe("splitSymbol — FDUSD, coté par Binance seulement (revues du 26/09)", () => {
  it("chez Binance : BTCFDUSD → BTC / FDUSD, WFDUSD → W / FDUSD, FDUSDUSDT → FDUSD / USDT", () => {
    expect(splitSymbol("BTCFDUSD", "binance")).toEqual({ base: "BTC", quote: "FDUSD" });
    expect(splitSymbol("WFDUSD", "Binance spot")).toEqual({ base: "W", quote: "FDUSD" });
    expect(splitSymbol("FDUSDUSDT", "binance")).toEqual({ base: "FDUSD", quote: "USDT" });
  });

  it("ailleurs, FDUSD n'est pas une cotation : UFD/USD de Kraken reste UFDUSD → UFD / USD", () => {
    expect(splitSymbol("UFDUSD", "Kraken")).toEqual({ base: "UFD", quote: "USD" });
    expect(basePerp("UFDUSD", "kraken")).toBe("UFD");
    expect(basePerp("BTCFDUSD", "binance")).toBe("BTC");
  });

  it("TUSD selon la place : DOT/USD de Coinbase reste DOT / USD, BTCTUSD de Binance → BTC / TUSD", () => {
    expect(splitSymbol("DOTUSD", "Coinbase")).toEqual({ base: "DOT", quote: "USD" });
    expect(splitSymbol("ACTUSD", "Kraken")).toEqual({ base: "ACT", quote: "USD" });
    expect(splitSymbol("BTCTUSD", "binance")).toEqual({ base: "BTC", quote: "TUSD" });
    expect(splitSymbol("TUSDUSDT", "binance")).toEqual({ base: "TUSD", quote: "USDT" });
  });
});
