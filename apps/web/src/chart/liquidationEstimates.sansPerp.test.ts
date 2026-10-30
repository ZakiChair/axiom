/**
 * LIQEST sans marché perp (lot fuites-séries-synthétiques, revue du 30/10) : EUR/USD donnait la base
 * « EUR », donc l'OI de EURUSDT chez Coinalyze (quota partagé de 40/min) puis le repli fapi, toutes
 * les 15 min. Garde `sansMarchePerp` à la synchronisation et au rafraîchissement ; un vrai perp
 * continue de rafraîchir. Vrais Coinalyze et referentiels, capteur fetch global.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mêmes stubs que liquidationEstimates.test.ts pour importer le module sous Node (effets de bord de
// ./liquidationMarkers) ; ni Coinalyze ni les referentiels ne sont simulés.
vi.mock("klinecharts", () => ({ registerOverlay: () => {} }));
vi.mock("./drawing", () => ({ getActiveChart: () => null }));
vi.mock("../store/theme", () => ({
  themeStore: { getState: () => ({ theme: "dark" }), subscribe: () => () => {} },
}));
vi.mock("../data/liquidations", () => ({ subscribeLiquidations: () => () => {} }));

const urls: string[] = [];
vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
  urls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  return new Response("{}", { status: 503 });
}));

import { liqEstStore, oiHistStore } from "./liquidationEstimates";
import { marketStore } from "../store/market";

const QUINZE_MIN = 15 * 60_000;
/** Requêtes d'OI de LIQEST : Coinalyze, puis le repli Binance. */
const requetesOi = (): string[] => urls.filter((u) => /open-interest-history|openInterestHist/.test(u));
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  urls.length = 0;
  // Seul le minuteur de 15 min est simulé : le flux fetch garde les vraies attentes.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});

afterEach(() => {
  liqEstStore.getState().setActif(false);
  vi.useRealTimers();
});

describe("LIQEST — aucune requête d'OI sans marché perp", () => {
  it("EUR/USD (Twelve Data) : rien à l'activation ni au rafraîchissement de 15 min ; légende sur OI vide", async () => {
    marketStore.getState().setMarket({ exchange: "twelvedata", symbol: "EUR/USD", timeframe: "1h" });
    liqEstStore.getState().setActif(true);
    await attendre(20);
    await vi.advanceTimersByTimeAsync(2 * QUINZE_MIN);
    await attendre(20);
    expect(requetesOi()).toEqual([]);
    expect(oiHistStore.getState()).toMatchObject({ hist: [], symbol: "EUR/USD" });
  });

  it("témoin : un vrai perp interroge l'OI à l'activation, puis toutes les 15 min", async () => {
    marketStore.getState().setMarket({ exchange: "binance", symbol: "BTCUSDT", timeframe: "1h" });
    liqEstStore.getState().setActif(true);
    await vi.waitFor(() => expect(requetesOi().some((u) => u.includes("BTCUSDT"))).toBe(true));
    const avant = requetesOi().length;
    await vi.advanceTimersByTimeAsync(QUINZE_MIN);
    await vi.waitFor(() => expect(requetesOi().length).toBeGreaterThan(avant));
  });

  // « Voir sur le chart » d'une alerte {synthetic, BTCUSDT}, puis l'identité routée republiée.
  it("changement de source seul : {synthetic, BTCUSDT} sans requête, puis binance → l'OI part ; bybit → rien de plus", async () => {
    marketStore.getState().setMarket({ exchange: "synthetic", symbol: "BTCUSDT", timeframe: "1h" });
    liqEstStore.getState().setActif(true);
    await attendre(20);
    expect(requetesOi()).toEqual([]);
    marketStore.getState().setExchange("binance");
    await vi.waitFor(() => expect(requetesOi().some((u) => u.includes("BTCUSDT"))).toBe(true));
    await attendre(20);
    const avant = requetesOi().length;
    // Entre deux perps, même symbole : même OI, aucune requête de plus (comme avant le lot).
    marketStore.getState().setExchange("bybit");
    await attendre(20);
    expect(requetesOi().length).toBe(avant);
  });
});
