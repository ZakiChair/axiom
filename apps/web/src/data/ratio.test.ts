import { describe, expect, it } from "vitest";
import { DENOMINATEURS, estRatio, symboleRatio } from "./ratio";

describe("symboleRatio — cible SYN X/DENOM pour le marché courant", () => {
  it("compose le ratio ÷BTC sur binance (réf BTCUSDT)", () => {
    expect(symboleRatio("ETHUSDT", "binance", "BTC")).toBe("binance:ETHUSDT|/|binance:BTCUSDT");
  });

  it("compose le ratio ÷BTC sur kraken (réf BTCUSD)", () => {
    expect(symboleRatio("SOLUSD", "kraken", "BTC")).toBe("kraken:SOLUSD|/|kraken:BTCUSD");
  });

  it("compose le ratio ÷BTC sur mexc (réf BTCUSDT)", () => {
    expect(symboleRatio("ETHUSDT", "mexc", "BTC")).toBe("mexc:ETHUSDT|/|mexc:BTCUSDT");
  });

  it("compose le ratio ÷BTC sur coinbase (réf BTCUSD)", () => {
    expect(symboleRatio("ETHUSD", "coinbase", "BTC")).toBe("coinbase:ETHUSD|/|coinbase:BTCUSD");
  });

  it("compose le ratio ÷ETH sur binance et mexc (réf ETHUSDT)", () => {
    expect(symboleRatio("SOLUSDT", "binance", "ETH")).toBe("binance:SOLUSDT|/|binance:ETHUSDT");
    expect(symboleRatio("SOLUSDT", "mexc", "ETH")).toBe("mexc:SOLUSDT|/|mexc:ETHUSDT");
  });

  it("compose le ratio ÷ETH sur kraken et coinbase (réf ETHUSD)", () => {
    expect(symboleRatio("SOLUSD", "kraken", "ETH")).toBe("kraken:SOLUSD|/|kraken:ETHUSD");
    expect(symboleRatio("SOLUSD", "coinbase", "ETH")).toBe("coinbase:SOLUSD|/|coinbase:ETHUSD");
  });

  it("compose le ratio ÷SOL sur les quatre sources", () => {
    expect(symboleRatio("ETHUSDT", "binance", "SOL")).toBe("binance:ETHUSDT|/|binance:SOLUSDT");
    expect(symboleRatio("ETHUSDT", "mexc", "SOL")).toBe("mexc:ETHUSDT|/|mexc:SOLUSDT");
    expect(symboleRatio("ETHUSD", "kraken", "SOL")).toBe("kraken:ETHUSD|/|kraken:SOLUSD");
    expect(symboleRatio("ETHUSD", "coinbase", "SOL")).toBe("coinbase:ETHUSD|/|coinbase:SOLUSD");
  });

  it("refuse une base déjà égale au dénominateur", () => {
    expect(symboleRatio("BTCUSDT", "binance", "BTC")).toBeNull();
    expect(symboleRatio("SOLUSDT", "binance", "SOL")).toBeNull();
    expect(symboleRatio("ETHUSDT", "binance", "ETH")).toBeNull();
  });

  it("refuse un symbole déjà coté dans le dénominateur (ETHBTC, SOLETH)", () => {
    expect(symboleRatio("ETHBTC", "binance", "BTC")).toBeNull();
    expect(symboleRatio("SOLETH", "binance", "ETH")).toBeNull();
  });

  it("autorise ETHBTC ÷SOL : ni la base ni la cotation ne sont SOL", () => {
    expect(symboleRatio("ETHBTC", "binance", "SOL")).toBe("binance:ETHBTC|/|binance:SOLUSDT");
  });

  it("compose CROSS-SOURCE un tradfi ÷ réf canonique Binance (or, indice, forex)", () => {
    expect(symboleRatio("GLD", "twelvedata", "BTC")).toBe("twelvedata:GLD|/|binance:BTCUSDT");
    expect(symboleRatio("SPY", "twelvedata", "ETH")).toBe("twelvedata:SPY|/|binance:ETHUSDT");
    // Ticker forex avec un `/` : jamais découpé (pas de splitSymbol sur ce chemin).
    expect(symboleRatio("EUR/USD", "twelvedata", "SOL")).toBe(
      "twelvedata:EUR/USD|/|binance:SOLUSDT",
    );
  });

  it("refuse une source sans réf ni composition cross-source (bybit, okx, hyperliquid)", () => {
    for (const denom of DENOMINATEURS) {
      expect(symboleRatio("ETHUSDT", "bybit", denom)).toBeNull();
      expect(symboleRatio("ETHUSDT", "okx", denom)).toBeNull();
      expect(symboleRatio("ETH", "hyperliquid", denom)).toBeNull();
    }
  });

  it("refuse la source virtuelle synthetic, pour tous les dénominateurs", () => {
    for (const denom of DENOMINATEURS) {
      expect(symboleRatio("binance:ETHUSDT|/|binance:BTCUSDT", "synthetic", denom)).toBeNull();
    }
  });

  it("renvoie null (pas de throw) sur un symbole indécoupable", () => {
    expect(symboleRatio("XYZ", "binance", "BTC")).toBeNull();
    expect(symboleRatio("XYZ", "binance", "SOL")).toBeNull();
  });
});

describe("estRatio — reconnaît un ratio posé par le toggle ET son dénominateur", () => {
  it("round-trip pour chaque dénominateur : legA et exA préservées", () => {
    for (const denom of DENOMINATEURS) {
      // BNBUSDT : base et cotation étrangères aux trois dénominateurs testés.
      const cible = symboleRatio("BNBUSDT", "binance", denom);
      expect(cible).not.toBeNull();
      const actif = estRatio(cible as string, "synthetic");
      expect(actif?.denom).toBe(denom);
      expect(actif?.spec.legA).toBe("BNBUSDT");
      expect(actif?.spec.exA).toBe("binance");
    }
  });

  it("distingue ÷ETH de ÷BTC sur le même marché", () => {
    expect(estRatio("binance:SOLUSDT|/|binance:ETHUSDT", "synthetic")?.denom).toBe("ETH");
    expect(estRatio("binance:SOLUSDT|/|binance:BTCUSDT", "synthetic")?.denom).toBe("BTC");
  });

  it("refuse l'opérateur spread (-)", () => {
    expect(estRatio("binance:ETHUSDT|-|binance:BTCUSDT", "synthetic")).toBeNull();
  });

  it("reconnaît un SYN CROSS-SOURCE dont la jambe B est la réf canonique Binance", () => {
    const tradfi = estRatio("twelvedata:GLD|/|binance:BTCUSDT", "synthetic");
    expect(tradfi?.denom).toBe("BTC");
    expect(tradfi?.spec.exA).toBe("twelvedata");
    expect(tradfi?.spec.legA).toBe("GLD");
    // La jambe A peut être N'IMPORTE QUELLE source non virtuelle (SYN bâti à la main).
    expect(estRatio("kraken:SOLUSD|/|binance:ETHUSDT", "synthetic")?.denom).toBe("ETH");
  });

  it("refuse un exB cross-source qui n'est pas l'exchange canonique (binance)", () => {
    // legB = BTCUSD = réf kraken : valable en MÊME source, jamais en cross-source.
    expect(estRatio("binance:ETHUSDT|/|kraken:BTCUSD", "synthetic")).toBeNull();
    expect(estRatio("twelvedata:GLD|/|kraken:BTCUSD", "synthetic")).toBeNull();
    // Ticker canonique (BTCUSDT) mais sur le MAUVAIS exchange : refusé aussi.
    expect(estRatio("binance:ETHUSDT|/|kraken:BTCUSDT", "synthetic")).toBeNull();
  });

  it("refuse un legB étranger aux réfs des dénominateurs", () => {
    expect(estRatio("binance:ETHUSDT|/|binance:BNBUSDT", "synthetic")).toBeNull();
    // Réf d'une AUTRE source que celle de la jambe B : ETHUSD est la réf kraken/coinbase,
    // pas binance — la jambe B se vérifie toujours contre la réf de SON exchange (exB).
    expect(estRatio("binance:SOLUSDT|/|binance:ETHUSD", "synthetic")).toBeNull();
    // Idem en cross-source : BTCUSD n'est pas la réf canonique binance (BTCUSDT).
    expect(estRatio("twelvedata:GLD|/|binance:BTCUSD", "synthetic")).toBeNull();
  });

  it("refuse un exchange autre que synthetic", () => {
    expect(estRatio("binance:ETHUSDT|/|binance:BTCUSDT", "binance")).toBeNull();
  });

  it("round-trip CROSS-SOURCE pour chaque dénominateur : legA et exA préservées", () => {
    for (const denom of DENOMINATEURS) {
      const cible = symboleRatio("GLD", "twelvedata", denom);
      expect(cible).not.toBeNull();
      const actif = estRatio(cible as string, "synthetic");
      expect(actif?.denom).toBe(denom);
      expect(actif?.spec.legA).toBe("GLD");
      expect(actif?.spec.exA).toBe("twelvedata");
    }
  });

  it("recomposition tradfi : la jambe A d'un ratio cross-source rebascule ÷ETH ⇄ ÷SOL", () => {
    const actif = estRatio("twelvedata:GLD|/|binance:BTCUSDT", "synthetic");
    expect(actif).not.toBeNull();
    if (actif === null) return;
    // Même patron que le cas same-source : SymbolBanner recompose depuis exA/legA.
    expect(symboleRatio(actif.spec.legA, actif.spec.exA, "ETH")).toBe(
      "twelvedata:GLD|/|binance:ETHUSDT",
    );
  });

  it("recomposition : depuis un ratio actif, la jambe A sert de base à un autre dénominateur", () => {
    const actif = estRatio("binance:BNBUSDT|/|binance:SOLUSDT", "synthetic");
    expect(actif).not.toBeNull();
    if (actif === null) return;
    expect(actif.denom).toBe("SOL");
    // Le SYN courant n'est pas basculable tel quel (source synthetic) : c'est la jambe A
    // qui se recompose — patron utilisé par SymbolBanner pour passer d'un ÷X à un ÷Y.
    expect(symboleRatio("binance:BNBUSDT|/|binance:SOLUSDT", "synthetic", "ETH")).toBeNull();
    expect(symboleRatio(actif.spec.legA, actif.spec.exA, "ETH")).toBe(
      "binance:BNBUSDT|/|binance:ETHUSDT",
    );
  });
});
