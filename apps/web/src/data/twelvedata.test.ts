import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseTwelveData,
  parseQuotes,
  twelveDataAdapter,
  utcDayKey,
  nextDailyCount,
  type DailyUsage,
  type TwelveDataResponse,
} from "./twelvedata";

/** Accès indexé gardé explicitement (noUncheckedIndexedAccess actif sur apps/web). */
function at<T>(arr: T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`index ${i} absent`);
  return v;
}

describe("parseTwelveData", () => {
  it("convertit values en bougies (ms) ; dernière non clôturée ; tri ascendant", () => {
    const json: TwelveDataResponse = {
      status: "ok",
      values: [
        { datetime: "2026-06-26", open: "275", high: "286", low: "274", close: "283.78", volume: "261693600" },
        { datetime: "2026-06-25", open: "270", high: "276", low: "269", close: "275", volume: "200000000" },
      ], // ordre DESC en entrée → doit être trié ASC
    };
    const c = parseTwelveData(json);
    expect(c).toHaveLength(2);
    expect(at(c, 0).time).toBe(Date.parse("2026-06-25T00:00:00Z"));
    expect(at(c, 1).time).toBe(Date.parse("2026-06-26T00:00:00Z"));
    expect(at(c, 0).closed).toBe(true);
    expect(at(c, 1).closed).toBe(false); // dernière (plus récente) = en cours
    expect(at(c, 1).close).toBe(283.78);
    expect(at(c, 1).volume).toBe(261693600);
  });

  it("intraday : datetime 'YYYY-MM-DD HH:MM:SS' interprété en UTC", () => {
    const json: TwelveDataResponse = {
      status: "ok",
      values: [{ datetime: "2026-06-26 14:30:00", open: "1", high: "2", low: "0.5", close: "1.5", volume: "10" }],
    };
    const c = parseTwelveData(json);
    expect(at(c, 0).time).toBe(Date.parse("2026-06-26T14:30:00Z"));
  });

  it("forex : volume absent → 0", () => {
    const json: TwelveDataResponse = {
      status: "ok",
      values: [{ datetime: "2026-06-28", open: "1.13889", high: "1.13967", low: "1.13808", close: "1.13843" }],
    };
    const c = parseTwelveData(json);
    expect(at(c, 0).volume).toBe(0);
  });

  it("écarte les barres non numériques", () => {
    const json: TwelveDataResponse = {
      status: "ok",
      values: [
        { datetime: "2026-06-26", open: "1", high: "2", low: "0.5", close: "1.5", volume: "10" },
        { datetime: "2026-06-27", open: "x", high: "y", low: "z", close: "w", volume: "" },
      ],
    };
    expect(parseTwelveData(json)).toHaveLength(1);
  });

  it("lève sur réponse d'erreur (clé invalide / symbole inconnu)", () => {
    const json: TwelveDataResponse = { status: "error", code: 401, message: "Invalid API key" };
    expect(() => parseTwelveData(json)).toThrow(/Twelve Data/);
  });

  it("renvoie [] si pas de values", () => {
    expect(parseTwelveData({ status: "ok" })).toEqual([]);
  });
});

describe("compteur journalier (quota ~800/j, reset minuit UTC)", () => {
  it("utcDayKey renvoie le jour calendaire UTC (YYYY-MM-DD), indépendant du fuseau", () => {
    // 23:30 UTC le 30 juin → jour UTC = 2026-06-30 (pas de bascule prématurée).
    expect(utcDayKey(new Date("2026-06-30T23:30:00Z"))).toBe("2026-06-30");
    // 00:10 UTC le 1er juillet → nouveau jour UTC.
    expect(utcDayKey(new Date("2026-07-01T00:10:00Z"))).toBe("2026-07-01");
  });

  it("nextDailyCount démarre à 1 sans compteur existant", () => {
    const now = new Date("2026-07-01T09:00:00Z");
    expect(nextDailyCount(null, now)).toEqual({ jour: "2026-07-01", count: 1 });
  });

  it("nextDailyCount incrémente dans le même jour UTC", () => {
    const stored: DailyUsage = { jour: "2026-07-01", count: 141 };
    const now = new Date("2026-07-01T18:00:00Z");
    expect(nextDailyCount(stored, now)).toEqual({ jour: "2026-07-01", count: 142 });
  });

  it("nextDailyCount RESET à 1 au changement de jour UTC (minuit UTC)", () => {
    const stored: DailyUsage = { jour: "2026-06-30", count: 799 };
    const now = new Date("2026-07-01T00:00:05Z"); // juste après minuit UTC → nouveau jour
    expect(nextDailyCount(stored, now)).toEqual({ jour: "2026-07-01", count: 1 });
  });
});

describe("parseQuotes", () => {
  it("forme MAP (plusieurs symboles) → prix + variation par symbole", () => {
    const json = {
      SPY: { close: "728.99", percent_change: "-0.72", currency: "USD" },
      "EUR/USD": { close: "1.13911", percent_change: "0.016", currency: null },
    };
    const out = parseQuotes(json, ["SPY", "EUR/USD"]);
    expect(out).toEqual([
      { symbol: "SPY", price: 728.99, changePercent: -0.72 },
      { symbol: "EUR/USD", price: 1.13911, changePercent: 0.016 },
    ]);
  });

  it("forme À PLAT (un seul symbole)", () => {
    const json = { symbol: "AAPL", close: "283.78", percent_change: "3.13" };
    expect(parseQuotes(json, ["AAPL"])).toEqual([
      { symbol: "AAPL", price: 283.78, changePercent: 3.13 },
    ]);
  });

  it("écarte un symbole en erreur ou sans close, garde les autres", () => {
    const json = {
      GLD: { close: "373.63", percent_change: "1.12" },
      ZZZZ: { status: "error", message: "symbol not found" },
    };
    expect(parseQuotes(json, ["GLD", "ZZZZ"])).toEqual([
      { symbol: "GLD", price: 373.63, changePercent: 1.12 },
    ]);
  });

  it("percent_change manquant → 0 (jamais NaN)", () => {
    const json = { close: "10" }; // 1 symbole → forme à plat
    expect(at(parseQuotes(json, ["X"]), 0).changePercent).toBe(0);
  });

  it("lève sur erreur GLOBALE (clé invalide, aucune donnée par symbole)", () => {
    const json = { status: "error", code: 401, message: "Invalid API key" };
    expect(() => parseQuotes(json, ["SPY", "GLD"])).toThrow(/Twelve Data quote/);
  });
});

/**
 * subscribeKline (polling) doit émettre la bougie PRÉCÉDENTE en closed:true exactement
 * une fois quand elle se clôture, AVANT de transmettre la bougie en cours — sinon les
 * indicateurs ne recalculent plus jamais après le backfill (régression réelle corrigée
 * ici). Timers + fetch mockés : déterministe, pas de réseau ni de navigateur requis.
 */
describe("twelveDataAdapter.subscribeKline — séquence closed:true", () => {
  let calls: number;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    calls = 0;
    fetchMock = vi.fn(() => {
      calls += 1;
      // Poll 1 & 2 : [A, B] (B encore "en cours") ; poll 3+ : [B, C] (B vient de clore).
      const values =
        calls <= 2
          ? [
              { datetime: "2024-01-01 00:00:00", open: "1", high: "1.1", low: "0.9", close: "1.05", volume: "10" },
              { datetime: "2024-01-01 00:01:00", open: "1.05", high: "1.2", low: "1", close: "1.1", volume: "20" },
            ]
          : [
              { datetime: "2024-01-01 00:01:00", open: "1.05", high: "1.2", low: "1", close: "1.1", volume: "20" },
              { datetime: "2024-01-01 00:02:00", open: "1.1", high: "1.3", low: "1.05", close: "1.2", volume: "30" },
            ];
      const json: TwelveDataResponse = { status: "ok", values };
      return Promise.resolve({ ok: true, json: () => Promise.resolve(json) });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("émet la bougie close une seule fois à sa clôture, jamais en double, avant la bougie en cours", async () => {
    const received: Array<{ time: number; closed: boolean | undefined }> = [];
    const unsubscribe = twelveDataAdapter.subscribeKline("AAPL", "1m", (c) => {
      received.push({ time: c.time, closed: c.closed });
    });

    await vi.advanceTimersByTimeAsync(60_000); // poll 1
    await vi.advanceTimersByTimeAsync(60_000); // poll 2
    await vi.advanceTimersByTimeAsync(60_000); // poll 3 — B se clôture

    unsubscribe();

    const tA = Date.parse("2024-01-01T00:00:00Z");
    const tB = Date.parse("2024-01-01T00:01:00Z");
    const tC = Date.parse("2024-01-01T00:02:00Z");

    expect(received).toEqual([
      { time: tA, closed: true }, // poll 1 : A déjà close, émise avant B
      { time: tB, closed: false }, // poll 1 : B en cours
      { time: tB, closed: false }, // poll 2 : B toujours en cours (PAS de ré-émission de A)
      { time: tB, closed: true }, // poll 3 : B vient de clore → recalcul des indicateurs
      { time: tC, closed: false }, // poll 3 : C, la nouvelle bougie en cours
    ]);
  });
});
