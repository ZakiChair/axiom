import { describe, expect, it } from "vitest";
import { chartDisplayStore, footprintDisponible, modeEffectif, preferencesAffichage } from "./chart-display";

describe("préférences de rendu", () => {
  it("ne contraint pas le rendu des sources sans flux de trades", () => {
    for (const exchange of ["twelvedata", "mexc", "synthetic"] as const) expect(footprintDisponible(exchange)).toBe(false);
    for (const exchange of ["binance", "kraken", "coinbase", "bybit", "okx", "hyperliquid"] as const) expect(footprintDisponible(exchange)).toBe(true);
  });
  it("restaure chaque vue sans accepter un mode inconnu ni des slots supplémentaires", () => {
    expect(preferencesAffichage(["area", "inconnu", "line", null, "area"]))
      .toEqual(["area", "candles", "line", "candles"]);
    expect(preferencesAffichage({ mode: "area" })).toEqual(Array(4).fill("candles"));
  });
  it("le footprint impose les bougies sans perdre les préférences des vues", () => {
    chartDisplayStore.getState().setMode(0, "area");
    chartDisplayStore.getState().setMode(2, "line");
    const modes = chartDisplayStore.getState().modes;
    expect(modeEffectif(modes[0]!, true)).toBe("candles");
    expect(modeEffectif(modes[0]!, false)).toBe("area");
    expect(modes[2]).toBe("line");
    chartDisplayStore.getState().setMode(4, "line");
    expect(chartDisplayStore.getState().modes).toEqual(modes);
  });
});
