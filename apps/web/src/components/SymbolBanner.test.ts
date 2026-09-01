/**
 * Tests des fonctions PURES du bandeau symbole (SymbolBanner). Le rendu React n'est pas
 * testé (pas d'environnement DOM ici) : on couvre le calcul de l'horodatage de clôture de
 * bougie et la fenêtre 24 h — seuls porteurs de régressions silencieuses. Le formatage
 * (prix/compact/%/rebours) est désormais partagé et testé dans lib/format.test.ts.
 *
 * `../data/ticker` est stubé : les helpers testés n'en dépendent pas, et le stub évite de
 * charger toute la chaîne réseau (WS/poll) à l'import du module component en environnement Node.
 */
import { beforeEach, describe, it, expect, vi } from "vitest";
import type { Candle } from "@axiom/types";
import {
  libelleSourceCapitalisation,
  nextCloseTs,
  rolling24h,
  subscribeSymbolBannerTicker,
} from "./SymbolBanner";

const { subscribeTickersMock } = vi.hoisted(() => ({
  subscribeTickersMock: vi.fn(() => () => {}),
}));

vi.mock("../data/ticker", () => ({
  classifyTradfi: () => "stock",
  isMarketOpen: () => true,
  isTickerSource: (source: string) =>
    ["binance", "kraken", "coinbase", "mexc", "twelvedata"].includes(source),
  subscribeTickers: subscribeTickersMock,
}));

beforeEach(() => {
  subscribeTickersMock.mockClear();
});

/** Fabrique une bougie minimale (seuls time/high/low/volume comptent pour rolling24h). */
function candle(time: number, high: number, low: number, volume: number): Candle {
  return { time, open: low, high, low, close: high, volume };
}

const HOUR = 3_600_000;

describe("nextCloseTs", () => {
  it("timeframes à pas fixe : openTime + durée", () => {
    expect(nextCloseTs(0, "1m")).toBe(60_000);
    expect(nextCloseTs(1_000, "5m")).toBe(1_000 + 300_000);
    expect(nextCloseTs(0, "1h")).toBe(HOUR);
    expect(nextCloseTs(0, "1d")).toBe(86_400_000);
    expect(nextCloseTs(0, "1w")).toBe(604_800_000);
  });

  it("timeframes calendaires : début du bucket suivant en UTC", () => {
    // 1M : janvier → février 2026.
    expect(nextCloseTs(Date.UTC(2026, 0, 1), "1M")).toBe(Date.UTC(2026, 1, 1));
    // 3M : Q1 (jan) → Q2 (avril).
    expect(nextCloseTs(Date.UTC(2026, 0, 1), "3M")).toBe(Date.UTC(2026, 3, 1));
    // 3M avec passage d'année : Q4 (oct) → Q1 de l'année suivante (janvier 2027).
    expect(nextCloseTs(Date.UTC(2026, 9, 1), "3M")).toBe(Date.UTC(2027, 0, 1));
    // 12M : année → année suivante.
    expect(nextCloseTs(Date.UTC(2026, 0, 1), "12M")).toBe(Date.UTC(2027, 0, 1));
  });
});

describe("rolling24h", () => {
  it("agrège haut/bas/volume sur la fenêtre des 24 h et s'arrête au-delà", () => {
    const ref = 100 * HOUR; // référence arbitraire
    const candles = [
      candle(ref - 30 * HOUR, 10, 1, 5), // hors fenêtre (> 24 h) → ignorée
      candle(ref - 10 * HOUR, 20, 8, 7), // dans la fenêtre
      candle(ref - 1 * HOUR, 15, 9, 3), // dans la fenêtre
    ];
    expect(rolling24h(candles, ref)).toEqual({ high: 20, low: 8, volume: 10 });
  });

  it("renvoie null quand aucune bougie n'est dans la fenêtre", () => {
    const ref = 100 * HOUR;
    expect(rolling24h([], ref)).toBeNull();
    expect(rolling24h([candle(ref - 30 * HOUR, 10, 1, 5)], ref)).toBeNull();
  });
});

describe("subscribeSymbolBannerTicker", () => {
  it.each(["binance", "kraken", "coinbase", "mexc", "twelvedata"] as const)(
    "force la source affichée %s sans consulter la provenance watchlist",
    (exchange) => {
      const cb = vi.fn();

      subscribeSymbolBannerTicker(exchange, "BTCUSD", cb);

      expect(subscribeTickersMock).toHaveBeenCalledWith(["BTCUSD"], cb, { source: exchange });
    },
  );

  it("ne crée aucun ticker pour une série synthétique", () => {
    subscribeSymbolBannerTicker("synthetic", "binance:BTCUSDT|/|twelvedata:GLD", vi.fn());

    expect(subscribeTickersMock).not.toHaveBeenCalled();
  });
});

describe("libelleSourceCapitalisation", () => {
  it("étiquette la source réellement servie et se tait tant qu'elle est inconnue", () => {
    expect(libelleSourceCapitalisation(undefined, "1d")).toBeNull();
    expect(libelleSourceCapitalisation("cmc", "1h")).toBe("CoinMarketCap · 1h");
    expect(libelleSourceCapitalisation("cmc", "4h")).toBe("CoinMarketCap · 4h");
    expect(libelleSourceCapitalisation("cmc", "1w")).toBe("CoinMarketCap · daily");
    expect(libelleSourceCapitalisation("ccdata", "1d")).toBe("CCData · daily");
    expect(libelleSourceCapitalisation("coingecko", "1h")).toBe("CoinGecko · local");
  });
});
