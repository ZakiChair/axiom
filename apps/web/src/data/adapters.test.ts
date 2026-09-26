import { describe, expect, it } from "vitest";
import {
  getAdapter,
  SUPPORTED_TIMEFRAMES,
  supportedTimeframesFor,
  syntheticTimeframes,
  timeframeProche,
} from "./adapters";

describe("getAdapter — nouvelles sources câblées", () => {
  it("renvoie les adaptateurs Bybit / OKX / Hyperliquid avec le bon id", () => {
    expect(getAdapter("bybit").id).toBe("bybit");
    expect(getAdapter("okx").id).toBe("okx");
    expect(getAdapter("hyperliquid").id).toBe("hyperliquid");
  });
});

describe("syntheticTimeframes", () => {
  it("calcule l'intersection binance x twelvedata dans l'ordre de Binance", () => {
    // Binance ∩ Twelve Data, d'après SUPPORTED_TIMEFRAMES : 1m, 5m, 15m, 1h, 4h, 1d, 1w, 1M.
    expect(syntheticTimeframes("binance", "twelvedata")).toEqual([
      "1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M",
    ]);
  });

  it("calcule l'intersection binance x kraken", () => {
    // Binance ∩ Kraken, dans l'ordre Binance : 1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w.
    expect(syntheticTimeframes("binance", "kraken")).toEqual([
      "1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w",
    ]);
  });

  it("borne une jambe de capitalisation aux unités disponibles", () => {
    expect(syntheticTimeframes("mcap", "binance")).toEqual([
      "1h", "4h", "1d", "1w", "1M", "3M", "6M", "12M",
    ]);
  });
});

describe("supportedTimeframesFor", () => {
  it("renvoie la table statique pour une source normale", () => {
    expect(supportedTimeframesFor("binance", "BTCUSDT")).toBe(SUPPORTED_TIMEFRAMES.binance);
  });

  it("renvoie l'intersection pour une source synthetic", () => {
    expect(supportedTimeframesFor("synthetic", "binance:A|/|kraken:B")).toEqual([
      "1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w",
    ]);
  });

  it("expose les huit unités demandées pour TOTAL et ses ratios Binance", () => {
    const attendus = ["1h", "4h", "1d", "1w", "1M", "3M", "6M", "12M"];
    expect(supportedTimeframesFor("synthetic", "TOTAL")).toEqual(attendus);
    expect(supportedTimeframesFor("synthetic", "mcap:TOTAL2|/|binance:ETHUSDT")).toEqual(attendus);
  });

  it("retire les unités où la grille Twelve Data n'est pas celle de l'autre jambe (aucune anticipation)", () => {
    // Or et forex 4h : barres à 01/05/09…Z en heure d'été (grille saisonnière).
    expect(supportedTimeframesFor("synthetic", "binance:BTCUSDT|/|twelvedata:XAU/USD")).toEqual([
      "1m", "5m", "15m", "1h", "1d", "1w", "1M",
    ]);
    // SPY/QQQ 1h et 4h : séance à :30 (13:30, 14:30… UTC).
    expect(supportedTimeframesFor("synthetic", "bybit:HYPEUSDT|/|twelvedata:SPY")).toEqual([
      "1m", "5m", "15m", "1d", "1w", "1M",
    ]);
    expect(supportedTimeframesFor("synthetic", "twelvedata:GLD|/|binance:BTCUSDT")).toEqual([
      "1m", "5m", "15m", "1d", "1w", "1M",
    ]);
    // Deux jambes Twelve Data de même nature : même grille, rien à retirer.
    expect(supportedTimeframesFor("synthetic", "twelvedata:AAPL|/|twelvedata:SPY")).toContain("1h");
    expect(supportedTimeframesFor("synthetic", "twelvedata:EUR/USD|/|twelvedata:CHF/USD")).toContain("4h");
    // Natures différentes : les deux grilles se retirent.
    expect(supportedTimeframesFor("synthetic", "twelvedata:SPY|/|twelvedata:EUR/USD")).not.toContain("1h");
  });

  it("renvoie une liste vide pour un symbole synthetic invalide", () => {
    expect(supportedTimeframesFor("synthetic", "BTCUSDT")).toEqual([]);
  });
});

describe("timeframeProche", () => {
  it("garde l'unité proposée, sinon la suivante plus longue, sinon la plus longue", () => {
    const spy = supportedTimeframesFor("synthetic", "binance:BTCUSDT|/|twelvedata:SPY");
    expect(timeframeProche(spy, "15m")).toBe("15m");
    expect(timeframeProche(spy, "1h")).toBe("1d");
    expect(timeframeProche(spy, "4h")).toBe("1d");
    expect(timeframeProche(["1m", "1h"], "1d")).toBe("1h");
    expect(timeframeProche([], "1h")).toBeUndefined();
  });
});
