import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildTwelveDataUrl,
  fetchQuotes,
  nextDailyCount,
  parseQuotes,
  parseTwelveData,
  quotaJourEpuise,
  setTwelveDataApiKey,
  twelveDataAdapter,
  utcDayKey,
  type DailyUsage,
  type TwelveDataResponse,
} from "./twelvedata";
import { healthStore } from "../store/health";

/** Accès indexé gardé explicitement (noUncheckedIndexedAccess actif sur apps/web). */
function at<T>(arr: T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`index ${i} absent`);
  return v;
}

describe("buildTwelveDataUrl", () => {
  it("construit une URL sans muter les paramètres et encode la clé personnelle", () => {
    const params = new URLSearchParams({ symbol: "EUR/USD", interval: "1day" });
    expect(buildTwelveDataUrl("/tdapi/time_series", params, "perso&1")).toBe(
      "/tdapi/time_series?symbol=EUR%2FUSD&interval=1day&apikey=perso%261",
    );
    expect(params.has("apikey")).toBe(false);
  });

  it("fonctionne avec la base directe Vercel et omet apikey sans clé personnelle", () => {
    expect(
      buildTwelveDataUrl("https://api.twelvedata.com/quote", { symbol: "SPY" }, null),
    ).toBe("https://api.twelvedata.com/quote?symbol=SPY");
  });
});

describe("clé personnelle Twelve Data", () => {
  beforeEach(() => {
    setTwelveDataApiKey("personnelle");
  });

  afterEach(() => {
    setTwelveDataApiKey(null);
    vi.unstubAllGlobals();
  });

  it("ajoute apikey aux requêtes time_series et quote", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const json = String(input).includes("time_series")
        ? { status: "ok", values: [] }
        : { symbol: "SPY", close: "100", percent_change: "1" };
      return Promise.resolve({
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(json),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await twelveDataAdapter.fetchKlines("URL_KEY_TEST", "1d", { limit: 2 });
    await fetchQuotes(["SPY"]);

    const urls = fetchMock.mock.calls.map(([input]) => new URL(String(input), "http://localhost"));
    expect(urls.map((url) => url.pathname)).toEqual([
      "/tdapi/time_series",
      "/tdapi/quote",
    ]);
    expect(urls.every((url) => url.searchParams.get("apikey") === "personnelle")).toBe(true);
  });
});

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

describe("quotaJourEpuise (plafond ~800 crédits/jour)", () => {
  const now = new Date("2026-07-01T12:00:00Z");

  it("vrai quand le compteur du MÊME jour UTC atteint la limite", () => {
    expect(quotaJourEpuise({ jour: "2026-07-01", count: 800 }, now)).toBe(true);
    expect(quotaJourEpuise({ jour: "2026-07-01", count: 799 }, now)).toBe(false);
  });

  it("faux sans compteur, ou pour un compteur d'un AUTRE jour UTC (reset minuit UTC)", () => {
    expect(quotaJourEpuise(null, now)).toBe(false);
    expect(quotaJourEpuise({ jour: "2026-06-30", count: 800 }, now)).toBe(false);
  });
});

describe("plafond journalier appliqué (acquireSlot)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    healthStore.getState().retirer("twelvedata:quotes");
  });

  it("refuse tout appel réseau quand le compteur du jour a atteint la limite", async () => {
    const jour = utcDayKey(new Date());
    const stockage = new Map<string, string>([
      ["axiom:twelvedata:daily:v1", JSON.stringify({ jour, count: 800 })],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => stockage.get(k) ?? null,
      setItem: (k: string, v: string) => void stockage.set(k, v),
    });
    const f = vi.fn();
    vi.stubGlobal("fetch", f);

    // Symbole unique : ne partage ni cache ni inflight avec les autres tests du fichier.
    await expect(twelveDataAdapter.fetchKlines("QUOTAJOURTEST", "1d")).rejects.toThrow(/quota journalier/);
    expect(f).not.toHaveBeenCalled(); // aucun crédit consommé

    // Vérifier que l'erreur quota est posée dans la santé (sticky jusqu'à minuit UTC).
    const state = healthStore.getState().sources["twelvedata:quotes"];
    expect(state?.etat).toBe("error");
    expect(state?.derniereErreur).toBe("quota journalier Twelve Data épuisé (800 crédits)");
  });

  it("lève l'erreur quota au jour suivant lors du premier succès (reportQuota)", async () => {
    vi.useFakeTimers();
    const jour1 = new Date("2026-07-01T12:00:00Z");
    vi.setSystemTime(jour1);

    // Jour 1 : brûler le quota, erreur posée
    const stockage = new Map<string, string>([
      ["axiom:twelvedata:daily:v1", JSON.stringify({ jour: "2026-07-01", count: 800 })],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => stockage.get(k) ?? null,
      setItem: (k: string, v: string) => void stockage.set(k, v),
    });
    const f = vi.fn();
    vi.stubGlobal("fetch", f);

    // Tentative 1 : quota épuisé jour 1
    await expect(twelveDataAdapter.fetchKlines("DAYCHANGETEST", "1d")).rejects.toThrow(/quota journalier/);
    let state = healthStore.getState().sources["twelvedata:quotes"];
    expect(state?.etat).toBe("error");
    expect(state?.derniereErreur).toBe("quota journalier Twelve Data épuisé (800 crédits)");

    // Jour 2 (minuit UTC passé) : compteur reset, requête réussit, erreur levée
    const jour2 = new Date("2026-07-02T00:00:05Z");
    vi.setSystemTime(jour2);

    stockage.clear();
    f.mockClear();
    f.mockResolvedValueOnce({
      status: 200,
      json: () => Promise.resolve({ status: "ok", values: [] }),
    });

    await twelveDataAdapter.fetchKlines("DAYCHANGETEST", "1d", { limit: 2 });

    // L'erreur quota doit être levée (derniereErreur = undefined, etat = "polling")
    state = healthStore.getState().sources["twelvedata:quotes"];
    expect(state?.etat).toBe("polling");
    expect(state?.derniereErreur).toBeUndefined();

    vi.useRealTimers();
  });

  it("n'efface pas une erreur NON-quota posée par ailleurs (ex. ticker.ts)", async () => {
    // Simuler une erreur polling posée par ticker.ts (non-quota)
    healthStore.getState().marquerErreur("twelvedata:quotes", "erreur réseau: Connection refused");

    const jour = utcDayKey(new Date());
    const stockage = new Map<string, string>([
      ["axiom:twelvedata:daily:v1", JSON.stringify({ jour, count: 0 })], // quota non épuisé
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => stockage.get(k) ?? null,
      setItem: (k: string, v: string) => void stockage.set(k, v),
    });
    const f = vi.fn();
    f.mockResolvedValueOnce({
      status: 200,
      json: () => Promise.resolve({ status: "ok", values: [] }),
    });
    vi.stubGlobal("fetch", f);

    // Requête réussit (quota OK)
    await twelveDataAdapter.fetchKlines("NONQUOTAERROR", "1d", { limit: 2 });

    // L'erreur NON-quota doit rester (reportQuota ne la lève pas)
    const state = healthStore.getState().sources["twelvedata:quotes"];
    expect(state?.derniereErreur).toBe("erreur réseau: Connection refused");
  });

  it("lève l'erreur quota FORMATÉE par ticker.ts sur le chemin watchlist réel (includes guard)", async () => {
    vi.useFakeTimers();
    const jour1 = new Date("2026-07-01T12:00:00Z");
    vi.setSystemTime(jour1);

    // Jour 1 : brûler le quota, ticker.ts va formater l'erreur
    const stockage = new Map<string, string>([
      ["axiom:twelvedata:daily:v1", JSON.stringify({ jour: "2026-07-01", count: 800 })],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => stockage.get(k) ?? null,
      setItem: (k: string, v: string) => void stockage.set(k, v),
    });

    // Simuler le message formaté par ticker.ts au catch de pollTradfiQuotes
    // (watchlist → fetchQuotes → pollTradfiQuotes → pollLoop catch → ticker.ts reformatte)
    const formattedError = `Twelve Data: quota journalier Twelve Data épuisé (800 crédits) — reset à minuit UTC`;
    healthStore.getState().marquerErreur("twelvedata:quotes", formattedError);

    // Vérifier que l'erreur formatée est posée
    let state = healthStore.getState().sources["twelvedata:quotes"];
    expect(state?.derniereErreur).toBe(formattedError);

    // Jour 2 (minuit UTC passé) : compteur reset, requête réussit
    const jour2 = new Date("2026-07-02T00:00:05Z");
    vi.setSystemTime(jour2);

    stockage.clear();
    const f = vi.fn();
    f.mockResolvedValueOnce({
      status: 200,
      json: () => Promise.resolve({ status: "ok", values: [] }),
    });
    vi.stubGlobal("fetch", f);

    // Requête réussit → reportQuota appelé
    await twelveDataAdapter.fetchKlines("FORMATTEDQUOTATEST", "1d", { limit: 2 });

    // La garde includes() doit reconnaître l'erreur formatée et la lever
    state = healthStore.getState().sources["twelvedata:quotes"];
    expect(state?.etat).toBe("polling");
    expect(state?.derniereErreur).toBeUndefined();

    vi.useRealTimers();
  });
});

describe("twelveDataAdapter.fetchKlines — pagination par end_date", () => {
  const PAGE_A = Date.parse("2026-06-26T14:00:00Z");
  const PAGE_B = Date.parse("2026-06-26T06:00:00Z");

  function valuesAt(times: number[]): TwelveDataResponse {
    return {
      status: "ok",
      values: times.map((t) => {
        const iso = new Date(t).toISOString().slice(0, 19).replace("T", " ");
        return { datetime: iso, open: "1", high: "2", low: "0.5", close: "1.5", volume: "10" };
      }),
    };
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("borne le cache des pages à 32 entrées sans conserver un repli périmé évincé", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const { twelveDataAdapter: adapter } = await import("./twelvedata");
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    const fetchMock = vi.fn(async () => Response.json(valuesAt([PAGE_B])));
    vi.stubGlobal("fetch", fetchMock);
    for (let i = 0; i < 33; i++) {
      // Horloge du module isolé : chaque requête dispose de son créneau de quota.
      vi.setSystemTime(Date.now() + 61_000);
      await adapter.fetchKlines("BOURNETD", "1m", { limit: 1, endTime: PAGE_A - i * 60_000 });
    }
    fetchMock.mockRejectedValue(new Error("amont indisponible"));
    vi.setSystemTime(Date.now() + 61_000);
    await expect(adapter.fetchKlines("BOURNETD", "1m", { limit: 1, endTime: PAGE_A })).rejects.toThrow("amont indisponible");
    expect(fetchMock).toHaveBeenCalledTimes(34);
  });

  it("transmet end_date UTC et distingue deux pages disjointes par la clé de cache", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const end = url.searchParams.get("end_date") ?? "";
      const json = end.includes("06:00") ? valuesAt([PAGE_B, PAGE_B + 60_000]) : valuesAt([PAGE_A, PAGE_A + 60_000]);
      return Promise.resolve({
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(json),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const recente = await twelveDataAdapter.fetchKlines("PAGETDA", "1m", { limit: 2, endTime: PAGE_A });
    const ancienne = await twelveDataAdapter.fetchKlines("PAGETDA", "1m", { limit: 2, endTime: PAGE_B });

    const urls = fetchMock.mock.calls.map(([input]) => new URL(String(input), "http://localhost"));
    expect(urls).toHaveLength(2);
    expect(urls[0]!.searchParams.get("end_date")).toMatch(/2026-06-26 14:00:00/);
    expect(urls[1]!.searchParams.get("end_date")).toMatch(/2026-06-26 06:00:00/);
    expect(urls[0]!.searchParams.get("end_date")).not.toBe(urls[1]!.searchParams.get("end_date"));
    expect(recente.map((c) => c.time)).not.toEqual(ancienne.map((c) => c.time));
  });

  it("ressert le cache pour la même borne (zéro second appel)", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(valuesAt([PAGE_A])),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await twelveDataAdapter.fetchKlines("CACHETD", "1m", { limit: 1, endTime: PAGE_A });
    await twelveDataAdapter.fetchKlines("CACHETD", "1m", { limit: 1, endTime: PAGE_A });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("points hors période → vide (pas de repli sur la queue récente)", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(valuesAt([PAGE_A, PAGE_A + 60_000])),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const hors = await twelveDataAdapter.fetchKlines("HORSTD", "1m", {
      limit: 2,
      endTime: PAGE_B,
    });
    expect(hors).toEqual([]);
  });
});

/**
 * File du quota 8 req/60 s : deux priorités (graphe > cotations, barres, sondages) et
 * abandon par AbortSignal. Module réimporté à chaque test : file et créneaux vierges.
 */
describe("file Twelve Data : priorités, abandon et fenêtre glissante", () => {
  const serie = { status: "ok", values: [{ datetime: "2026-01-02", open: "1", high: "2", low: "0.5", close: "1.5", volume: "10" }] };
  let stockage: Map<string, string>;
  let envois: Array<{ at: number; url: string }>;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-07-01T12:00:00Z"));
    stockage = new Map();
    vi.stubGlobal("localStorage", { getItem: (k: string) => stockage.get(k) ?? null, setItem: (k: string, v: string) => void stockage.set(k, v) });
    envois = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      envois.push({ at: Date.now(), url });
      const symbol = new URL(url, "http://localhost").searchParams.get("symbol") ?? "";
      const quote = (s: string) => ({ symbol: s, close: "100", percent_change: "1" });
      const json = !url.includes("/quote") ? serie : symbol.includes(",") ? Object.fromEntries(symbol.split(",").map((s) => [s, quote(s)])) : quote(symbol);
      return { status: 200, statusText: "OK", json: async () => json };
    }));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  const credits = () => (JSON.parse(stockage.get("axiom:twelvedata:daily:v1") ?? "{\"count\":0}") as { count: number }).count;
  /** Crédits réellement envoyés : un par série, un par symbole d'une cotation. */
  const creditsEnvoi = ({ url }: { url: string }) => url.includes("/quote") ? (new URL(url, "http://localhost").searchParams.get("symbol") ?? "").split(",").length : 1;
  const maxCredits60s = () => Math.max(0, ...envois.map(({ at }) => envois.filter((e) => e.at > at - 60_000 && e.at <= at).reduce((n, e) => n + creditsEnvoi(e), 0)));
  /** Occupe les huit créneaux de la fenêtre courante. */
  async function saturer(td: typeof import("./twelvedata")): Promise<void> {
    await Promise.all(Array.from({ length: 8 }, (_, i) => td.fetchKlinesTwelveData(`PLEIN${i}`, "1d")));
    expect(envois).toHaveLength(8);
  }

  it("une demande abandonnée sort de la file sans consommer de créneau ni de crédit", async () => {
    const td = await import("./twelvedata");
    await saturer(td);
    const controleur = new AbortController();
    const onCreneau = vi.fn();
    const abandonnee = td.fetchKlinesTwelveData("AMZN", "1d", { limit: 500 }, { signal: controleur.signal, priorite: "graphe", onCreneau });
    await vi.advanceTimersByTimeAsync(20_000);
    controleur.abort();
    await expect(abandonnee).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(envois).toHaveLength(8);
    expect(credits()).toBe(8);
    expect(onCreneau).not.toHaveBeenCalled();
    // Le créneau libéré sert immédiatement la demande suivante.
    await td.fetchKlinesTwelveData("META", "1d");
    expect(envois).toHaveLength(9);
    expect(credits()).toBe(9);
  });

  it("le backfill du graphe passe devant trois cotations déjà en file", async () => {
    const td = await import("./twelvedata");
    await saturer(td);
    const quotes = ["SPY", "QQQ", "GLD"].map((symbol) => td.fetchQuotes([symbol]));
    const graphe = td.fetchKlinesTwelveData("AAPL", "1d", { limit: 500 }, { priorite: "graphe" });
    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.all([graphe, ...quotes]);
    expect(envois.slice(8).map(({ url }) => new URL(url, "http://localhost").searchParams.get("symbol"))).toEqual(["AAPL", "SPY", "QQQ", "GLD"]);
    expect(envois[8]!.url).toContain("/time_series");
  });

  it("ne dépasse jamais 8 requêtes sur une fenêtre glissante de 60 s", async () => {
    const td = await import("./twelvedata");
    const demandes: Array<Promise<unknown>> = [];
    for (let i = 0; i < 26; i++) {
      demandes.push(i % 3 === 0 ? td.fetchQuotes([`Q${i}`]) : td.fetchKlinesTwelveData(`S${i}`, "1h", {}, { priorite: i % 2 ? "graphe" : "fond" }));
      await vi.advanceTimersByTimeAsync(3_700);
    }
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    await Promise.all(demandes);
    expect(envois).toHaveLength(26);
    for (const { at } of envois) expect(envois.filter((e) => e.at > at - 60_000 && e.at <= at).length).toBeLessThanOrEqual(8);
  });

  it("une cotation groupée réserve ses crédits d'un seul coup : jamais plus de 8 crédits envoyés sur 60 s glissantes", async () => {
    const td = await import("./twelvedata");
    const demandes: Array<Promise<unknown>> = [];
    for (const symbol of ["A", "B", "C", "D", "E", "F", "G"]) demandes.push(td.fetchQuotes([symbol]));
    await vi.advanceTimersByTimeAsync(10_000);
    demandes.push(td.fetchQuotes(["AAPL", "MSFT"]));
    await vi.advanceTimersByTimeAsync(51_000);
    for (const symbol of ["KO", "PEP", "XOM", "BA", "V", "MA"]) demandes.push(td.fetchQuotes([symbol]));
    await vi.advanceTimersByTimeAsync(9_500);
    demandes.push(td.fetchQuotes(["JPM"]));
    await vi.advanceTimersByTimeAsync(120_000);
    await Promise.all(demandes);
    expect(envois.reduce((n, e) => n + creditsEnvoi(e), 0)).toBe(16);
    expect(maxCredits60s()).toBeLessThanOrEqual(8);
    expect(credits()).toBe(16);
  });

  it("au-delà de 8 symboles, la cotation part en lots d'au plus 8 crédits", async () => {
    const td = await import("./twelvedata");
    const symboles = Array.from({ length: 10 }, (_, i) => `T${i}`);
    const cotation = td.fetchQuotes(symboles);
    await vi.advanceTimersByTimeAsync(120_000);
    expect((await cotation).map((q) => q.symbol)).toEqual(symboles);
    expect(envois.map(creditsEnvoi)).toEqual([8, 2]);
    expect(maxCredits60s()).toBeLessThanOrEqual(8);
  });

  it("une cotation groupée abandonnée en file ne consomme ni créneau ni crédit", async () => {
    const td = await import("./twelvedata");
    await Promise.all(Array.from({ length: 6 }, (_, i) => td.fetchKlinesTwelveData(`PLEIN${i}`, "1d")));
    const controleur = new AbortController();
    const cotation = td.fetchQuotes(["AAPL", "MSFT", "NVDA"], { signal: controleur.signal });
    await vi.advanceTimersByTimeAsync(3_500);
    controleur.abort();
    await expect(cotation).rejects.toMatchObject({ name: "AbortError" });
    expect(credits()).toBe(6);
    // Les deux créneaux libres servent aussitôt le graphe.
    await td.fetchKlinesTwelveData("AMZN", "1d", {}, { priorite: "graphe", attenteMaxMs: 20_000 });
    expect(envois).toHaveLength(7);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(envois.some(({ url }) => url.includes("/quote"))).toBe(false);
  });

  it("l'attente annoncée compte le poids des cotations en file", async () => {
    const td = await import("./twelvedata");
    await Promise.all(Array.from({ length: 4 }, (_, i) => td.fetchKlinesTwelveData(`PLEIN${i}`, "1d")));
    await vi.advanceTimersByTimeAsync(10_000);
    // Quatre crédits libres, que la cotation de quatre symboles prend d'un coup.
    void td.fetchQuotes(["A", "B", "C", "D"]);
    await expect(td.fetchKlinesTwelveData("AMZN", "1d", {}, { attenteMaxMs: 20_000 })).rejects.toThrow("Quota Twelve Data : prochain créneau dans 50 s");
  });

  it("une requête partagée n'est annulée que lorsque son dernier abonné l'abandonne", async () => {
    const td = await import("./twelvedata");
    await saturer(td);
    const a = new AbortController();
    const b = new AbortController();
    const premier = td.fetchKlinesTwelveData("NVDA", "1d", {}, { signal: a.signal, priorite: "graphe" });
    const second = td.fetchKlinesTwelveData("NVDA", "1d", {}, { signal: b.signal, priorite: "graphe" });
    a.abort();
    await expect(premier).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await second).length).toBe(1);
    expect(envois.filter(({ url }) => url.includes("NVDA"))).toHaveLength(1);

    // Fenêtre de nouveau pleine (NVDA + sept) : MSFT attend en file.
    await Promise.all(Array.from({ length: 7 }, (_, i) => td.fetchKlinesTwelveData(`AUTRE${i}`, "1d")));
    const c = new AbortController();
    const d = new AbortController();
    const troisieme = td.fetchKlinesTwelveData("MSFT", "1d", {}, { signal: c.signal });
    const quatrieme = td.fetchKlinesTwelveData("MSFT", "1d", {}, { signal: d.signal });
    c.abort();
    await expect(troisieme).rejects.toMatchObject({ name: "AbortError" });
    d.abort();
    await expect(quatrieme).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(envois.filter(({ url }) => url.includes("MSFT"))).toHaveLength(0);
    expect(credits()).toBe(16);
  });

  it("un signal déjà abandonné n'envoie rien et ne laisse aucun rejet non géré", async () => {
    const td = await import("./twelvedata");
    const nonGeres: unknown[] = [];
    const surRejet = (raison: unknown) => { nonGeres.push(raison); };
    process.on("unhandledRejection", surRejet);
    try {
      const controleur = new AbortController();
      controleur.abort();
      await expect(td.fetchKlinesTwelveData("DEJAABANDONNE", "1d", {}, { signal: controleur.signal })).rejects.toMatchObject({ name: "AbortError" });
      vi.useRealTimers(); // les rejets non gérés sont signalés après une vraie macrotâche
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(nonGeres).toEqual([]);
      expect(envois).toHaveLength(0);
    } finally { process.off("unhandledRejection", surRejet); }
  });

  it("un abonné graphe promeut une requête de fond partagée devant les autres demandes de fond", async () => {
    const td = await import("./twelvedata");
    await saturer(td);
    const fond = ["SPY", "QQQ"].map((symbol) => td.fetchQuotes([symbol]));
    const partagee = td.twelveDataAdapter.fetchKlines("TSLA", "1d", { limit: 500 });
    const graphe = td.fetchKlinesTwelveData("TSLA", "1d", { limit: 500 }, { priorite: "graphe" });
    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.all([partagee, graphe, ...fond]);
    expect(envois[8]!.url).toContain("TSLA");
    expect(envois.filter(({ url }) => url.includes("TSLA"))).toHaveLength(1);
  });

  it("annonce l'obtention du créneau, et refuse d'emblée une attente de quota trop longue", async () => {
    const td = await import("./twelvedata");
    await saturer(td);
    await vi.advanceTimersByTimeAsync(10_000);
    const refus = td.fetchKlinesTwelveData("AMZN", "1d", {}, { priorite: "graphe", attenteMaxMs: 20_000 });
    await expect(refus).rejects.toThrow("Quota Twelve Data : prochain créneau dans 50 s");
    await vi.advanceTimersByTimeAsync(35_000);
    const onCreneau = vi.fn();
    const acceptee = td.fetchKlinesTwelveData("AMZN", "1d", {}, { priorite: "graphe", attenteMaxMs: 20_000, onCreneau });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(onCreneau).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onCreneau).toHaveBeenCalledTimes(1);
    await acceptee;
    expect(envois.filter(({ url }) => url.includes("AMZN"))).toHaveLength(1);
    // Servi par le cache : le créneau est réputé obtenu tout de suite.
    const depuisCache = vi.fn();
    await td.fetchKlinesTwelveData("AMZN", "1d", {}, { onCreneau: depuisCache });
    expect(depuisCache).toHaveBeenCalledTimes(1);
  });

  it("le graphe qui rejoint une série encore en file garde sa limite d'attente, refusé seul et sans promotion", async () => {
    const td = await import("./twelvedata");
    await saturer(td);
    await vi.advanceTimersByTimeAsync(5_000);
    const cotation = td.fetchQuotes(["SPY"]);
    const fond = td.twelveDataAdapter.fetchKlines("XOM", "1d", { limit: 500 });
    const onCreneau = vi.fn();
    const graphe = td.fetchKlinesTwelveData("XOM", "1d", { limit: 500 }, { priorite: "graphe", attenteMaxMs: 20_000, onCreneau });
    await expect(graphe).rejects.toThrow("Quota Twelve Data : prochain créneau dans 55 s");
    // La série partagée n'est ni annulée ni promue : la cotation arrivée avant passe d'abord.
    await vi.advanceTimersByTimeAsync(55_000);
    expect((await fond).length).toBe(1);
    await cotation;
    expect(envois.slice(8).map(({ url }) => new URL(url, "http://localhost").searchParams.get("symbol"))).toEqual(["SPY", "XOM"]);
    expect(onCreneau).not.toHaveBeenCalled();
  });

  it("refusé en rejoignant une série en file, le graphe reçoit sa version périmée comme une série neuve", async () => {
    const td = await import("./twelvedata");
    await td.fetchKlinesTwelveData("XOM", "1d", { limit: 500 });
    await vi.advanceTimersByTimeAsync(61_000);
    await Promise.all(Array.from({ length: 8 }, (_, i) => td.fetchKlinesTwelveData(`PLEIN${i}`, "1d")));
    const fond = td.twelveDataAdapter.fetchKlines("XOM", "1d", { limit: 500 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await td.fetchKlinesTwelveData("XOM", "1d", { limit: 500 }, { priorite: "graphe", attenteMaxMs: 20_000 })).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60_000);
    await fond;
    expect(envois.filter(({ url }) => url.includes("XOM"))).toHaveLength(2);
  });

  it("le graphe rejoint une série en file servie dans sa limite : accepté, créneau annoncé", async () => {
    const td = await import("./twelvedata");
    await saturer(td);
    await vi.advanceTimersByTimeAsync(45_000);
    const cotation = td.fetchQuotes(["SPY"]);
    const fond = td.twelveDataAdapter.fetchKlines("XOM", "1d", { limit: 500 });
    const onCreneau = vi.fn();
    // Promue, la série passe devant la cotation : premier créneau libre, dans 15 s.
    const graphe = td.fetchKlinesTwelveData("XOM", "1d", { limit: 500 }, { priorite: "graphe", attenteMaxMs: 20_000, onCreneau });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(onCreneau).toHaveBeenCalledTimes(1);
    expect(await graphe).toEqual(await fond);
    await cotation;
    expect(envois.slice(8).map(({ url }) => new URL(url, "http://localhost").searchParams.get("symbol"))).toEqual(["XOM", "SPY"]);
  });

  it("build Vercel : la clé enregistrée est relue sans attendre l'ouverture des Réglages", async () => {
    vi.stubEnv("VITE_TWELVE_DATA_API_BASE", "https://api.twelvedata.com");
    stockage.set("axiom:twelvedata:key", " enregistree ");
    const td = await import("./twelvedata");
    await td.fetchKlinesTwelveData("AAPL", "1d");
    expect(envois[0]!.url).toMatch(/^https:\/\/api\.twelvedata\.com\/time_series\?.*apikey=enregistree/);
  });

  it("une clé effacée dans les Réglages n'est pas ressuscitée par cette relecture", async () => {
    vi.stubEnv("VITE_TWELVE_DATA_API_BASE", "https://api.twelvedata.com");
    stockage.set("axiom:twelvedata:key", "ancienne");
    const td = await import("./twelvedata");
    td.setTwelveDataApiKey(null);
    await expect(td.fetchKlinesTwelveData("AAPL", "1d")).rejects.toThrow(/clé Twelve Data requise/);
    expect(envois).toHaveLength(0);
  });

  it("les Réglages enregistrent la clé sous le nom relu par le module de données", async () => {
    const { twelveDataKeyStore } = await import("../store/twelvedata");
    twelveDataKeyStore.getState().setKey("abc");
    expect(stockage.get("axiom:twelvedata:key")).toBe("abc");
  });

  it("le sondage de la bougie courante quitte la file à l'arrêt, sans consommer de créneau", async () => {
    const td = await import("./twelvedata");
    const stop = td.twelveDataAdapter.subscribeKline("AAPL", "1m", () => {});
    await vi.advanceTimersByTimeAsync(30_000);
    await saturer(td);
    // Premier sondage à +60 s : la fenêtre est pleine jusqu'à +90 s, il attend en file.
    await vi.advanceTimersByTimeAsync(40_000);
    expect(envois).toHaveLength(8);
    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(envois).toHaveLength(8);
    expect(credits()).toBe(8);
  });

  it("sans clé, en appel direct à api.twelvedata.com, échoue immédiatement sans requête (401 certaine)", async () => {
    vi.stubEnv("VITE_TWELVE_DATA_API_BASE", "https://api.twelvedata.com");
    const td = await import("./twelvedata");
    const { dataLoadErrorMessage } = await import("../chart/dataLoadErrorMessage");
    const erreur = await td.fetchKlinesTwelveData("AAPL", "1d").catch((e: unknown) => e);
    expect(String(erreur)).toMatch(/clé Twelve Data requise/);
    expect(dataLoadErrorMessage(erreur)).toBe("Twelve Data nécessite une clé personnelle valide. Vérifiez-la dans les Réglages.");
    await expect(td.fetchQuotes(["SPY"])).rejects.toThrow(/clé Twelve Data requise/);
    expect(envois).toHaveLength(0);
    // Avec une clé personnelle, l'appel direct part normalement.
    td.setTwelveDataApiKey("perso");
    await td.fetchKlinesTwelveData("AAPL", "1d");
    expect(envois[0]!.url).toMatch(/^https:\/\/api\.twelvedata\.com\/time_series\?.*apikey=perso/);
  });

  it("le proxy local /tdapi (clé .env injectée) n'est jamais bloqué sans clé personnelle", async () => {
    const td = await import("./twelvedata");
    await td.fetchKlinesTwelveData("AAPL", "1d");
    expect(envois[0]!.url).toMatch(/^\/tdapi\/time_series\?/);
  });
});
