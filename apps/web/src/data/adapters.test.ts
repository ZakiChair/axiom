import { describe, expect, it } from "vitest";
import {
  SUPPORTED_TIMEFRAMES,
  supportedTimeframesFor,
  syntheticTimeframes,
} from "./adapters";

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

  it("renvoie une liste vide pour un symbole synthetic invalide", () => {
    expect(supportedTimeframesFor("synthetic", "BTCUSDT")).toEqual([]);
  });
});
