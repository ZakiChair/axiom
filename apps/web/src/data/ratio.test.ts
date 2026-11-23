import { describe, expect, it } from "vitest";
import { composerRatioLibre, DENOMINATEURS, DENOMINATEURS_MATIERES, detailDenominateur, deviseCotation, estRatio, libelleDenominateur, noteDollar, symboleRatio } from "./ratio";

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

  it("compose aussi sur Bybit, OKX et les perps Hyperliquid (HYPEUSDT routé sur Bybit le 26/09)", () => {
    expect(symboleRatio("HYPEUSDT", "bybit", "BTC")).toBe("bybit:HYPEUSDT|/|bybit:BTCUSDT");
    expect(symboleRatio("HYPEUSDT", "okx", "ETH")).toBe("okx:HYPEUSDT|/|okx:ETHUSDT");
    expect(symboleRatio("HYPE-PERP", "hyperliquid", "SOL")).toBe("hyperliquid:HYPE-PERP|/|hyperliquid:SOL-PERP");
    expect(symboleRatio("BTC-PERP", "hyperliquid", "BTC")).toBeNull();
    // Coin Hyperliquid nu (ancienne session) : pas de désignation -PERP, pas de ratio.
    expect(symboleRatio("ETH", "hyperliquid", "BTC")).toBeNull();
  });

  it("compose TOTAL, TOTAL2 et TOTAL3 contre les références canoniques", () => {
    expect(symboleRatio("TOTAL", "synthetic", "BTC")).toBe("mcap:TOTAL|/|binance:BTCUSDT");
    expect(symboleRatio("TOTAL2", "synthetic", "ETH")).toBe("mcap:TOTAL2|/|binance:ETHUSDT");
    expect(symboleRatio("TOTAL3", "synthetic", "SOL")).toBe("mcap:TOTAL3|/|binance:SOLUSDT");
  });

  it("refuse les synthétiques qui ne sont pas une capitalisation autonome", () => {
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

  it("reconnaît les ratios de capitalisation et conserve leur jambe mcap", () => {
    const actif = estRatio("mcap:TOTAL3|/|binance:SOLUSDT", "synthetic");
    expect(actif?.denom).toBe("SOL");
    expect(actif?.spec.exA).toBe("mcap");
    expect(actif?.spec.legA).toBe("TOTAL3");
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
    if (actif === null || actif.spec.exA === "mcap") return;
    // Même patron que le cas same-source : SymbolBanner recompose depuis exA/legA.
    expect(symboleRatio(actif.spec.legA, actif.spec.exA, "ETH")).toBe(
      "twelvedata:GLD|/|binance:ETHUSDT",
    );
  });

  it("recomposition : depuis un ratio actif, la jambe A sert de base à un autre dénominateur", () => {
    const actif = estRatio("binance:BNBUSDT|/|binance:SOLUSDT", "synthetic");
    expect(actif).not.toBeNull();
    if (actif === null || actif.spec.exA === "mcap") return;
    expect(actif.denom).toBe("SOL");
    // Le SYN courant n'est pas basculable tel quel (source synthetic) : c'est la jambe A
    // qui se recompose — patron utilisé par SymbolBanner pour passer d'un ÷X à un ÷Y.
    expect(symboleRatio("binance:BNBUSDT|/|binance:SOLUSDT", "synthetic", "ETH")).toBeNull();
    expect(symboleRatio(actif.spec.legA, actif.spec.exA, "ETH")).toBe(
      "binance:BNBUSDT|/|binance:ETHUSDT",
    );
  });
});

describe("garde cross-source : paires crypto en saisie libre Twelve Data (revue v2.6)", () => {
  it("refuse une paire dont une jambe EST le dénominateur (SYN mort ou double division)", () => {
    // BTC/USD ÷BTC ≈ constante 1 ; ETH/BTC ÷BTC = double division — bouton absent.
    expect(symboleRatio("BTC/USD", "twelvedata", "BTC")).toBeNull();
    expect(symboleRatio("ETH/BTC", "twelvedata", "BTC")).toBeNull();
    expect(symboleRatio("ETH/USD", "twelvedata", "ETH")).toBeNull();
    expect(symboleRatio("SOL/USD", "twelvedata", "SOL")).toBeNull();
  });

  it("laisse passer les paires à barre oblique dont aucune jambe n'est le dénominateur", () => {
    // EUR/USD ÷BTC reste composable (aucune jambe n'est BTC).
    expect(symboleRatio("EUR/USD", "twelvedata", "BTC")).toBe(
      "twelvedata:EUR/USD|/|binance:BTCUSDT",
    );
    // ETH/BTC ÷SOL : étrange mais inoffensif — aucune jambe n'est SOL.
    expect(symboleRatio("ETH/BTC", "twelvedata", "SOL")).toBe(
      "twelvedata:ETH/BTC|/|binance:SOLUSDT",
    );
  });
});

describe("dénominateurs marchés et devises (demande du 26/09/2026) : jambe Twelve Data unique", () => {
  it("divise un actif coté en dollar par l'or spot, le Nasdaq 100 (QQQ) et le S&P 500 (SPY)", () => {
    expect(symboleRatio("BTCUSDT", "binance", "OR")).toBe("binance:BTCUSDT|/|twelvedata:XAU/USD");
    expect(symboleRatio("HYPEUSDT", "bybit", "NASDAQ")).toBe("bybit:HYPEUSDT|/|twelvedata:QQQ");
    expect(symboleRatio("BTCUSD", "kraken", "SP500")).toBe("kraken:BTCUSD|/|twelvedata:SPY");
    expect(symboleRatio("ETHUSDC", "coinbase", "OR")).toBe("coinbase:ETHUSDC|/|twelvedata:XAU/USD");
    expect(symboleRatio("HYPE-PERP", "hyperliquid", "OR")).toBe("hyperliquid:HYPE-PERP|/|twelvedata:XAU/USD");
    expect(symboleRatio("AAPL", "twelvedata", "SP500")).toBe("twelvedata:AAPL|/|twelvedata:SPY");
    expect(symboleRatio("TOTAL", "synthetic", "OR")).toBe("mcap:TOTAL|/|twelvedata:XAU/USD");
  });

  it("exprime un actif en devise par sa paire CCY/USD (BTC en CHF = BTCUSDT ÷ CHF/USD)", () => {
    expect(symboleRatio("BTCUSDT", "binance", "CHF")).toBe("binance:BTCUSDT|/|twelvedata:CHF/USD");
    expect(symboleRatio("BTCUSDT", "binance", "JPY")).toBe("binance:BTCUSDT|/|twelvedata:JPY/USD");
    expect(symboleRatio("SPY", "twelvedata", "EUR")).toBe("twelvedata:SPY|/|twelvedata:EUR/USD");
    // EUR/USD ÷ CHF/USD = EUR/CHF : une paire X/USD reste divisible.
    expect(symboleRatio("EUR/USD", "twelvedata", "CHF")).toBe("twelvedata:EUR/USD|/|twelvedata:CHF/USD");
  });

  it("refuse un actif qui n'est pas coté en dollar : deux devises mélangées", () => {
    expect(symboleRatio("BTCEUR", "kraken", "OR")).toBeNull();
    expect(symboleRatio("ETHBTC", "binance", "CHF")).toBeNull();
    expect(symboleRatio("USD/JPY", "twelvedata", "CHF")).toBeNull();
    expect(symboleRatio("EUR/GBP", "twelvedata", "SP500")).toBeNull();
  });

  it("refuse l'actif divisé par lui-même ou par sa propre devise", () => {
    expect(symboleRatio("XAU/USD", "twelvedata", "OR")).toBeNull();
    expect(symboleRatio("SPY", "twelvedata", "SP500")).toBeNull();
    expect(symboleRatio("QQQ", "twelvedata", "NASDAQ")).toBeNull();
    expect(symboleRatio("EUR/USD", "twelvedata", "EUR")).toBeNull();
    expect(symboleRatio("EURUSDT", "binance", "EUR")).toBeNull();
    expect(symboleRatio("binance:ETHUSDT|/|binance:BTCUSDT", "synthetic", "OR")).toBeNull();
  });

  it("estRatio reconnaît la jambe Twelve Data et permet le retour à la jambe A", () => {
    const or = estRatio("binance:BTCUSDT|/|twelvedata:XAU/USD", "synthetic");
    expect(or?.denom).toBe("OR");
    expect(or?.spec).toMatchObject({ exA: "binance", legA: "BTCUSDT" });
    expect(estRatio("bybit:HYPEUSDT|/|twelvedata:CHF/USD", "synthetic")?.denom).toBe("CHF");
    expect(estRatio("mcap:TOTAL|/|twelvedata:SPY", "synthetic")?.denom).toBe("SP500");
    // Jambe Twelve Data étrangère aux dénominateurs : non reconnue.
    expect(estRatio("binance:BTCUSDT|/|twelvedata:GLD", "synthetic")).toBeNull();
    // Réf Twelve Data posée sur une autre source : non reconnue.
    expect(estRatio("binance:BTCUSDT|/|binance:XAU/USD", "synthetic")).toBeNull();
  });

  it("recomposition : d'un ratio en CHF à un ratio ÷Or, puis ÷BTC, depuis la jambe A", () => {
    const actif = estRatio("binance:SOLUSDT|/|twelvedata:CHF/USD", "synthetic");
    if (actif === null || actif.spec.exA === "mcap") throw new Error("ratio attendu");
    expect(symboleRatio(actif.spec.legA, actif.spec.exA, "OR")).toBe("binance:SOLUSDT|/|twelvedata:XAU/USD");
    expect(symboleRatio(actif.spec.legA, actif.spec.exA, "BTC")).toBe("binance:SOLUSDT|/|binance:BTCUSDT");
  });

  it("libellés : ÷BTC, ÷Or, ETF nommé pour les indices, « en CHF » pour les devises", () => {
    expect(libelleDenominateur("BTC")).toBe("÷BTC");
    expect(libelleDenominateur("OR")).toBe("÷Or");
    expect(libelleDenominateur("SP500")).toBe("÷S&P 500 (SPY)");
    expect(libelleDenominateur("NASDAQ")).toBe("÷Nasdaq 100 (QQQ)");
    expect(libelleDenominateur("CHF")).toBe("en CHF");
    expect(detailDenominateur("SP500")).toContain("SPY");
    for (const denom of DENOMINATEURS) expect(libelleDenominateur(denom).length).toBeGreaterThan(0);
  });
});

describe("revue du 26/09 : gardes et libellés des dénominateurs marchés et devises", () => {
  it("estRatio ne reconnaît une jambe Twelve Data que si la jambe A est cotée en dollar", () => {
    // ETHBTC ÷ EUR/USD : unité BTC·USD/EUR, pas « ETHBTC en EUR ».
    expect(estRatio("binance:ETHBTC|/|twelvedata:EUR/USD", "synthetic")).toBeNull();
    expect(estRatio("kraken:BTCEUR|/|twelvedata:XAU/USD", "synthetic")).toBeNull();
    expect(estRatio("binance:BTCUSDT|/|twelvedata:EUR/USD", "synthetic")?.denom).toBe("EUR");
  });

  it("refuse un ticker Twelve Data à place explicite (RY:TSX, coté en CAD)", () => {
    expect(symboleRatio("RY:TSX", "twelvedata", "CHF")).toBeNull();
    expect(symboleRatio("RY:TSX", "twelvedata", "OR")).toBeNull();
  });

  it("précise que l'ETF n'est pas le niveau de l'indice", () => {
    expect(detailDenominateur("SP500")).toContain("≈ SPX/10");
    expect(detailDenominateur("NASDAQ")).toContain("≈ NDX/41");
  });

  it("signale le stablecoin compté pour 1 USD (et l'USDC des perps Hyperliquid)", () => {
    expect(noteDollar("BTCUSDT", "binance")).toBe("USDT compté pour 1 USD");
    expect(noteDollar("ETHUSDC", "coinbase")).toBe("USDC compté pour 1 USD");
    expect(noteDollar("HYPE-PERP", "hyperliquid")).toBe("perp réglé en USDC, compté pour 1 USD");
    expect(noteDollar("BTCFDUSD", "binance")).toBe("FDUSD compté pour 1 USD");
    expect(noteDollar("BTCUSD", "kraken")).toBeNull();
    expect(noteDollar("SPY", "twelvedata")).toBeNull();
  });
});

describe("vérification du 26/09 : une paire en dollar n'est pas annoncée en TUSD", () => {
  it("Coinbase DOTUSD : ÷Or proposé, sans note de stablecoin", () => {
    expect(symboleRatio("DOTUSD", "coinbase", "OR")).toBe("coinbase:DOTUSD|/|twelvedata:XAU/USD");
    expect(noteDollar("DOTUSD", "coinbase")).toBeNull();
    expect(noteDollar("BTCTUSD", "binance")).toBe("TUSD compté pour 1 USD");
  });
});

describe("STABLE.D (dominance, série en %) : aucun ratio ni conversion de devise", () => {
  it("aucun dénominateur ne la compose : ni ÷BTC/÷ETH/÷SOL, ni ÷Or/÷QQQ/÷SPY, ni « en CHF »", () => {
    for (const denom of DENOMINATEURS) expect(symboleRatio("STABLE.D", "synthetic", denom)).toBeNull();
    expect(noteDollar("STABLE.D", "synthetic")).toBeNull();
  });

  it("un SYN bâti à la main sur une jambe mcap:STABLE.D n'est jamais reconnu comme ratio actif", () => {
    expect(estRatio("mcap:STABLE.D|/|binance:BTCUSDT", "synthetic")).toBeNull();
    expect(estRatio("mcap:STABLE.D|/|twelvedata:XAU/USD", "synthetic")).toBeNull();
  });

  it("TOTAL3 garde ÷BTC, ÷SOL et ÷Or (non-régression du parcours gate v2.5)", () => {
    expect(symboleRatio("TOTAL3", "synthetic", "BTC")).toBe("mcap:TOTAL3|/|binance:BTCUSDT");
    expect(symboleRatio("TOTAL3", "synthetic", "SOL")).toBe("mcap:TOTAL3|/|binance:SOLUSDT");
    expect(symboleRatio("TOTAL3", "synthetic", "OR")).toBe("mcap:TOTAL3|/|twelvedata:XAU/USD");
    expect(estRatio("mcap:TOTAL3|/|binance:SOLUSDT", "synthetic")?.denom).toBe("SOL");
  });
});

describe("matières premières (demande du 22/11/2026)", () => {
  const ETF = [["ARGENT", "SLV"], ["PLATINE", "PPLT"], ["PALLADIUM", "PALL"], ["CUIVRE", "CPER"], ["PETROLE", "USO"], ["BRENT", "BNO"], ["GAZ", "UNG"], ["BLE", "WEAT"], ["MAIS", "CORN"], ["SOJA", "SOYB"], ["SUCRE", "CANE"], ["AGRICULTURE", "DBA"], ["PANIER", "DBC"]] as const;

  it("compose chaque matière première pour un actif en dollar, un ticker Twelve Data et TOTAL", () => {
    for (const [id, etf] of ETF) {
      expect(symboleRatio("BTCUSDT", "binance", id)).toBe(`binance:BTCUSDT|/|twelvedata:${etf}`);
      expect(symboleRatio("AAPL", "twelvedata", id)).toBe(`twelvedata:AAPL|/|twelvedata:${etf}`);
      expect(symboleRatio("TOTAL", "synthetic", id)).toBe(`mcap:TOTAL|/|twelvedata:${etf}`);
    }
  });
  it("refuse un actif hors dollar et l'ETF divisé par lui-même", () => {
    expect(symboleRatio("BTCEUR", "kraken", "CUIVRE")).toBeNull();
    expect(symboleRatio("CPER", "twelvedata", "CUIVRE")).toBeNull();
    expect(symboleRatio("USO", "twelvedata", "PETROLE")).toBeNull();
    expect(symboleRatio("GLD", "twelvedata", "OR")).toBe("twelvedata:GLD|/|twelvedata:XAU/USD");
  });
  it("la garde « base = dénominateur » ne vaut que pour les devises", () => {
    expect(symboleRatio("GAZUSDT", "binance", "GAZ")).toBe("binance:GAZUSDT|/|twelvedata:UNG");
    expect(symboleRatio("EURUSDT", "binance", "EUR")).toBeNull();
  });
  it("estRatio reconnaît chaque matière première et rend la jambe A", () => {
    for (const id of DENOMINATEURS_MATIERES) {
      const actif = estRatio(symboleRatio("BTCUSDT", "binance", id) as string, "synthetic");
      expect(actif?.denom).toBe(id);
      expect(actif?.spec.legA).toBe("BTCUSDT");
    }
  });
  it("libellés : l'ETF est toujours nommé ; infobulles : nature et spot refusé", () => {
    expect(DENOMINATEURS_MATIERES.map(libelleDenominateur)).toEqual(["÷Or", "÷Argent (SLV)", "÷Platine (PPLT)", "÷Palladium (PALL)", "÷Cuivre (CPER)", "÷Pétrole WTI (USO)", "÷Brent (BNO)", "÷Gaz naturel (UNG)", "÷Blé (WEAT)", "÷Maïs (CORN)", "÷Soja (SOYB)", "÷Sucre (CANE)", "÷Agriculture (DBA)", "÷Matières premières (DBC)"]);
    expect(detailDenominateur("CUIVRE")).toBe("le cuivre via l'ETF CPER (prix de la part, contrats à terme renouvelés : écart possible au cours sur plusieurs années) ; le spot HG1 exige une offre Twelve Data supérieure");
    expect(detailDenominateur("ARGENT")).toBe("l'argent via l'ETF SLV (prix de la part, adossé au métal) ; le spot XAG/USD exige une offre Twelve Data supérieure");
    expect(detailDenominateur("PALLADIUM")).not.toContain("spot");
    expect(detailDenominateur("AGRICULTURE")).toContain("café");
  });
  it("ordre des familles : crypto, indices, matières premières, devises", () => {
    expect(DENOMINATEURS).toEqual(["BTC", "ETH", "SOL", "NASDAQ", "SP500", "OR", "ARGENT", "PLATINE", "PALLADIUM", "CUIVRE", "PETROLE", "BRENT", "GAZ", "BLE", "MAIS", "SOJA", "SUCRE", "AGRICULTURE", "PANIER", "EUR", "GBP", "CHF", "JPY", "CAD", "AUD"]);
  });
});

describe("« Autre actif… » : composition libre (lot 2)", () => {
  it("deviseCotation : devise du prix, stablecoins comptés USD, null si inconnue", () => {
    const table: Array<[string, Parameters<typeof deviseCotation>[1], string | null]> = [
      ["BTCUSDT", "binance", "USD"], ["BTCEUR", "kraken", "EUR"], ["ETHBTC", "binance", "BTC"], ["HYPE-PERP", "hyperliquid", "USD"],
      ["SPY", "twelvedata", "USD"], ["USD/JPY", "twelvedata", "JPY"], ["XAU/USD", "twelvedata", "USD"], ["RY:TSX", "twelvedata", null],
      ["TOTAL", "synthetic", "USD"], ["STABLE.D", "synthetic", null], ["XYZ", "binance", null], ["XAU/USD", "binance", null],
    ];
    for (const [symbol, exchange, attendu] of table) expect(deviseCotation(symbol, exchange)).toEqual(attendu);
  });

  it("composerRatioLibre : compositions libres", () => {
    expect(composerRatioLibre("BTCUSD", "coinbase", { exchange: "binance", symbol: "BTCUSDT" })).toEqual({ symbole: "coinbase:BTCUSD|/|binance:BTCUSDT", denom: null });
    expect(composerRatioLibre("ETHBTC", "binance", { exchange: "binance", symbol: "ADABTC" })).toEqual({ symbole: "binance:ETHBTC|/|binance:ADABTC", denom: null });
    expect(composerRatioLibre("BTCUSDT", "binance", { exchange: "twelvedata", symbol: "AAPL" })).toEqual({ symbole: "binance:BTCUSDT|/|twelvedata:AAPL", denom: null });
    expect(composerRatioLibre("TOTAL", "synthetic", { exchange: "twelvedata", symbol: "AAPL" })).toEqual({ symbole: "mcap:TOTAL|/|twelvedata:AAPL", denom: null });
    expect(composerRatioLibre("BTCUSDT", "binance", { exchange: "synthetic", symbol: "TOTAL2" })).toEqual({ symbole: "binance:BTCUSDT|/|mcap:TOTAL2", denom: null });
  });

  it("composerRatioLibre : refus", () => {
    expect(composerRatioLibre("ETHUSDT", "binance", { exchange: "binance", symbol: "ETHUSDT" })).toEqual({ refus: "Même actif que le graphique" });
    expect(composerRatioLibre("BTCUSDT", "binance", { exchange: "twelvedata", symbol: "USD/JPY" })).toEqual({ refus: "Devises différentes (USD contre JPY)" });
    expect(composerRatioLibre("BTCEUR", "kraken", { exchange: "twelvedata", symbol: "CPER" })).toEqual({ refus: "Devises différentes (EUR contre USD)" });
    expect(composerRatioLibre("BTCUSDT", "binance", { exchange: "twelvedata", symbol: "RY:TSX" })).toEqual({ refus: "Devise de cotation inconnue" });
    expect(composerRatioLibre("BTCUSDT", "binance", { exchange: "synthetic", symbol: "STABLE.D" })).toEqual({ refus: "Série en % ou déjà composée : pas un diviseur" });
    expect(composerRatioLibre("binance:ETHUSDT|-|binance:BTCUSDT", "synthetic", { exchange: "twelvedata", symbol: "AAPL" })).toEqual({ refus: "Graphique composé : revenez à un actif simple" });
  });
});
