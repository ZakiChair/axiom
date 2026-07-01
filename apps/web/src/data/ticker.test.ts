/**
 * Tests de la logique PURE de routage/gating des tickers (data/ticker.ts) :
 *  - isTradfiSymbol / resolveTickerSource : aiguillage crypto vs tradfi + slash crypto ;
 *  - classifyTradfi + isMarketOpen : gate « marché fermé » (roadmap 0.4d).
 * Valeurs attendues justifiées en commentaire (heures UTC, jours de semaine explicités).
 */
import { describe, expect, it } from "vitest";
import {
  classifyTradfi,
  isMarketOpen,
  isTradfiSymbol,
  resolveTickerSource,
} from "./ticker";

describe("isTradfiSymbol", () => {
  it("classe tradfi les symboles du catalogue curé", () => {
    expect(isTradfiSymbol("SPY")).toBe(true); // ETF S&P500 (catalogue)
    expect(isTradfiSymbol("EUR/USD")).toBe(true); // forex (catalogue)
  });

  it("classe tradfi une paire forex fiat/fiat hors catalogue", () => {
    expect(isTradfiSymbol("USD/SEK")).toBe(true); // deux codes fiat ISO → forex
  });

  it("NE classe PAS tradfi une notation de paire crypto à slash (bug 0.4b)", () => {
    // "XBT/USD" : XBT n'est pas un code fiat → crypto, pas Twelve Data (évite le mauvais routage).
    expect(isTradfiSymbol("XBT/USD")).toBe(false);
  });

  it("classe tradfi les préfixes/suffixes d'indice, future et place boursière", () => {
    expect(isTradfiSymbol("^GSPC")).toBe(true); // indice
    expect(isTradfiSymbol("GC=F")).toBe(true); // future
    expect(isTradfiSymbol("AIR.PA")).toBe(true); // place (Euronext Paris)
  });

  it("NE classe PAS tradfi un symbole crypto concaténé standard", () => {
    expect(isTradfiSymbol("BTCUSDT")).toBe(false);
  });
});

describe("resolveTickerSource", () => {
  it("privilégie la source EXPLICITE du store si présente", () => {
    expect(resolveTickerSource("BTCUSD", "kraken")).toBe("kraken");
    expect(resolveTickerSource("SPY", "binance")).toBe("binance"); // explicite gagne sur l'inférence
  });

  it("infère Twelve Data pour un symbole tradfi sans source explicite", () => {
    expect(resolveTickerSource("SPY")).toBe("twelvedata");
    expect(resolveTickerSource("EUR/USD")).toBe("twelvedata");
  });

  it("infère Binance par défaut pour un symbole crypto sans source explicite", () => {
    expect(resolveTickerSource("BTCUSDT")).toBe("binance");
    // "XBT/USD" non tradfi → binance (puis écarté du WS à cause du slash, en aval).
    expect(resolveTickerSource("XBT/USD")).toBe("binance");
  });
});

describe("classifyTradfi", () => {
  it("un symbole à slash est du forex", () => {
    expect(classifyTradfi("EUR/USD")).toBe("forex");
  });
  it("un symbole sans slash est une action/ETF", () => {
    expect(classifyTradfi("SPY")).toBe("stock");
    expect(classifyTradfi("AAPL")).toBe("stock");
  });
});

describe("isMarketOpen — crypto (jamais gaté)", () => {
  it("toujours ouvert, y compris le week-end en pleine nuit", () => {
    // Samedi 2026-01-03 03:00 UTC : le crypto reste ouvert.
    expect(isMarketOpen("crypto", new Date(Date.UTC(2026, 0, 3, 3, 0)))).toBe(true);
  });
});

describe("isMarketOpen — actions/ETF US (lun-ven 13:20-20:10 UTC)", () => {
  // 2026-01-07 est un MERCREDI (2026-01-01 = jeudi).
  it("ouvert en pleine séance (15:00 UTC un mercredi)", () => {
    expect(isMarketOpen("stock", new Date(Date.UTC(2026, 0, 7, 15, 0)))).toBe(true);
  });
  it("ouvert pile à la borne basse 13:20 UTC (inclusive)", () => {
    expect(isMarketOpen("stock", new Date(Date.UTC(2026, 0, 7, 13, 20)))).toBe(true);
  });
  it("fermé avant l'ouverture (12:00 UTC)", () => {
    expect(isMarketOpen("stock", new Date(Date.UTC(2026, 0, 7, 12, 0)))).toBe(false);
  });
  it("fermé pile à la borne haute 20:10 UTC (exclusive)", () => {
    expect(isMarketOpen("stock", new Date(Date.UTC(2026, 0, 7, 20, 10)))).toBe(false);
  });
  it("fermé le week-end (samedi 15:00 UTC)", () => {
    // 2026-01-03 = samedi.
    expect(isMarketOpen("stock", new Date(Date.UTC(2026, 0, 3, 15, 0)))).toBe(false);
  });
});

describe("isMarketOpen — forex (dim 22:00 UTC → ven 22:00 UTC)", () => {
  it("fermé le samedi (toute la journée)", () => {
    // 2026-01-03 = samedi.
    expect(isMarketOpen("forex", new Date(Date.UTC(2026, 0, 3, 15, 0)))).toBe(false);
  });
  it("fermé le dimanche avant 22:00 UTC, ouvert à partir de 22:00 UTC", () => {
    // 2026-01-04 = dimanche.
    expect(isMarketOpen("forex", new Date(Date.UTC(2026, 0, 4, 21, 0)))).toBe(false);
    expect(isMarketOpen("forex", new Date(Date.UTC(2026, 0, 4, 22, 0)))).toBe(true);
  });
  it("ouvert le vendredi avant 22:00 UTC, fermé à partir de 22:00 UTC", () => {
    // 2026-01-02 = vendredi.
    expect(isMarketOpen("forex", new Date(Date.UTC(2026, 0, 2, 21, 0)))).toBe(true);
    expect(isMarketOpen("forex", new Date(Date.UTC(2026, 0, 2, 22, 0)))).toBe(false);
  });
  it("ouvert en pleine nuit un jour de semaine (contrairement aux actions)", () => {
    // Mercredi 2026-01-07 03:00 UTC : forex ouvert, actions fermées.
    expect(isMarketOpen("forex", new Date(Date.UTC(2026, 0, 7, 3, 0)))).toBe(true);
    expect(isMarketOpen("stock", new Date(Date.UTC(2026, 0, 7, 3, 0)))).toBe(false);
  });
});
