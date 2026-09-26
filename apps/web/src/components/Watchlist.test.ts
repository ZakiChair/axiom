/**
 * Règles PURES de lisibilité de la watchlist (env vitest node, pas de jsdom).
 * Le rendu (troncature réelle à 1440×240) est vérifié par e2e/corrections-revue.e2e.ts.
 * La résolution des provenances vit hors React : testée ici à timers simulés, avec le vrai
 * routage des sondes, un cache de profondeur simulé et un réseau bouchonné (aucun appel réel).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExchangeId, Timeframe } from "@axiom/types";
import { colonnesWatchlistPourLargeur, nouvelleSessionProvenances, suivreProvenancesFavoris } from "./Watchlist";
import * as routing from "../data/marketRouting";
import * as profondeur from "../data/profondeurHistorique";
import * as ticker from "../data/ticker";
import { marketStore } from "../store/market";
import { ajouterAWatchlist } from "../store/screener";
import { PRINCIPAL_GROUP_ID, watchlistStore } from "../store/watchlist";

// store/screener tire lib/navigation (klinecharts, pont de dessin) : stubs inertes hors navigateur.
vi.mock("klinecharts", () => ({ registerOverlay: () => {} }));
vi.mock("../chart/drawing", () => ({ getActiveChart: () => null, setFocusChart: () => {} }));

describe("lisibilité watchlist", () => {
  it("à 240 px (sidebar w-60) masque la sparkline et garde le Δ% 24h", () => {
    const cols = colonnesWatchlistPourLargeur(240);
    expect(cols.change24h).toBe(true);
    expect(cols.spark).toBe(false);
  });

  it("à largeur confortable garde sparkline et Δ% 24h", () => {
    const cols = colonnesWatchlistPourLargeur(360);
    expect(cols.change24h).toBe(true);
    expect(cols.spark).toBe(true);
  });
});

const reponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const spot = (...entrees: Array<[ExchangeId, string]>): routing.MarketCatalog => ({
  instruments: entrees.map(([exchange, symbol]) => ({ exchange, symbol, kind: "spot" as const })),
  unavailableSources: [],
});

/** Twelve Data sans l'abonnement requis (WTI/USD en clé gratuite) : aucun prix, jamais. */
const abonnementRequis = () => ({ code: 403, status: "error", message: "/quote is available exclusively with grow or pro plans" });

/** Paires que sert le ticker spot groupé de Bybit dans ce réseau bouchonné. */
const COTES_BYBIT = ["BTCUSDT", "ETHUSDT", "HYPEUSDT"];

/**
 * Réseau bouchonné : prix Binance 24 h, OKX par instrument, liste spot Bybit et /quote Twelve Data ;
 * `sansPrix` (« place:SYMBOLE ») simule un prix absent, `delaiMs` une réponse lente.
 */
function reseau(sansPrix = new Set<string>(), quoteTd: (url: string) => unknown = abonnementRequis, delaiMs = 0) {
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = String(input);
    urls.push(url);
    if (delaiMs) await new Promise((fin) => setTimeout(fin, delaiMs));
    const params = new URL(url, "http://local").searchParams;
    if (url.startsWith("/tdapi/quote?")) return reponse(quoteTd(url));
    if (url.startsWith("https://api.binance.com/api/v3/ticker/24hr")) {
      const symbol = params.get("symbol") ?? "";
      if (sansPrix.has(`binance:${symbol}`)) return new Response("{}", { status: 503 });
      // Binance ne cote pas CARDS : son ticker répond « Invalid symbol », comme en réel.
      if (symbol === "CARDSUSDT") return new Response(JSON.stringify({ code: -1121, msg: "Invalid symbol." }), { status: 400 });
      return reponse({ symbol, lastPrice: "100", priceChangePercent: "1" });
    }
    if (url.startsWith("https://www.okx.com/api/v5/market/ticker?")) {
      const instId = params.get("instId") ?? "";
      return reponse({ code: "0", data: sansPrix.has(`okx:${instId.replace("-", "")}`) ? [] : [{ instType: "SPOT", instId, last: "0.12", open24h: "0.1" }] });
    }
    if (url === "https://api.bybit.com/v5/market/tickers?category=spot") {
      const list = COTES_BYBIT.filter((symbol) => !sansPrix.has(`bybit:${symbol}`)).map((symbol) => ({ symbol, lastPrice: "40", prevPrice24h: "39" }));
      return reponse({ retCode: 0, result: { category: "spot", list } });
    }
    return new Response("{}", { status: 503 });
  }));
  return urls;
}

const BINANCE = (symbol: string) => `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`;
const OKX = (instId: string) => `https://www.okx.com/api/v5/market/ticker?instId=${instId}`;
const BYBIT = "https://api.bybit.com/v5/market/tickers?category=spot";

/** Catalogue servi sans réseau ; `publier` simule une republication (autre surface, réessai). */
function catalogue(initial: routing.MarketCatalog) {
  let listener: ((catalog: routing.MarketCatalog) => void) | undefined;
  vi.spyOn(routing, "fetchMarketCatalog").mockResolvedValue(initial);
  vi.spyOn(routing, "subscribeMarketCatalog").mockImplementation((next) => {
    listener = next;
    return () => { listener = undefined; };
  });
  return { publier: (catalog: routing.MarketCatalog) => listener?.(catalog) };
}

const date = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
/**
 * Cache de profondeur simulé : début d'historique accessible par « place:SYMBOLE » (par unité
 * de temps au besoin) ; clé absente : mesure inconnue, comme une sonde en échec.
 */
function profondeurs(table: Record<string, number | Partial<Record<Timeframe, number>>>) {
  vi.spyOn(profondeur, "debutAccessible").mockImplementation((exchange, symbol, timeframe) => {
    const debut = table[`${exchange}:${symbol}`];
    return typeof debut === "object" ? debut[timeframe] : debut;
  });
}
/**
 * Mesure LENTE, pas en échec (cache froid : nouvel appareil, entrées expirées) : `mesures` entre au
 * cache au bout de `ms` ; chaque attente est bornée par son délai et une mesure finie n'est pas
 * refaite, comme dans le vrai module.
 */
function mesureLente(mesures: Record<string, number>, ms: number) {
  const table: Record<string, number> = {};
  profondeurs(table);
  let fin: Promise<void> | undefined;
  vi.mocked(profondeur.mesurerProfondeurs).mockImplementation((_places, delai = 2_500) => {
    fin ??= new Promise((ok) => setTimeout(() => { Object.assign(table, mesures); ok(); }, ms));
    return Promise.race([fin, new Promise<void>((ok) => setTimeout(ok, delai))]);
  });
}
/** Premières bougies relevées le 26/09/2026 : Binance n'a pas une semaine d'historique HYPEUSDT. */
const P_HYPE = { "binance:HYPEUSDT": date("2026-09-24"), "bybit:HYPEUSDT": date("2025-07-11"), "okx:HYPEUSDT": date("2025-11-04") };
const HYPE = () => spot(["binance", "HYPEUSDT"], ["bybit", "HYPEUSDT"], ["okx", "HYPEUSDT"]);
/** BTCUSDT : Binance et OKX au même début accessible, profondeur équivalente. */
const P_BTC = { "binance:BTCUSDT": date("2024-06-15"), "okx:BTCUSDT": date("2024-06-15") };

/** Graphe prêt sur `exchange:symbol` (vrai cycle du store, sans backfill réseau). */
function graphePret(exchange: ExchangeId, symbol: string, timeframe: Timeframe = "1h") {
  const identity = { exchange, symbol, timeframe };
  marketStore.getState().setMarket(identity);
  const requestId = marketStore.getState().startDataLoad(identity);
  if (requestId === null) throw new Error("backfill refusé");
  marketStore.getState().completeDataLoad(identity, requestId, [{ time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 }]);
}

describe("provenances des favoris", () => {
  let stop: () => void = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    // Profondeur d'historique : aucune sonde de bougies dans le réseau bouchonné (cache simulé au besoin).
    vi.spyOn(profondeur, "mesurerProfondeurs").mockResolvedValue();
    // Actif affiché hors watchlist et pas encore prêt : aucun raccourci « graphe prêt ».
    marketStore.getState().setMarket({ exchange: "binance", symbol: "XRPUSDT", timeframe: "1h" });
  });
  afterEach(() => {
    stop();
    stop = () => {};
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    watchlistStore.getState().setAll([]);
  });

  it("[TOTAL, BTCUSDT(binance)] : seul le favori sans source est sondé, puis plus rien pendant 90 s", async () => {
    watchlistStore.getState().setAll(["TOTAL", "TOTAL2", "binance:ETHUSDT|/|binance:BTCUSDT", "BTCUSDT", "ETHUSDT"], { BTCUSDT: "binance", TOTAL2: "synthetic" });
    catalogue(spot(["binance", "BTCUSDT"], ["binance", "ETHUSDT"]));
    const urls = reseau();
    const sonde = vi.spyOn(ticker, "resolveTickerMarket");
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    expect(sonde).toHaveBeenCalledTimes(1);
    expect(urls).toEqual([BINANCE("ETHUSDT")]);
    await vi.advanceTimersByTimeAsync(90_000);
    // Les synthétiques restent sans prix de favoris : ni sondés, ni réessayés.
    expect(sonde).toHaveBeenCalledTimes(1);
    expect(urls).toHaveLength(1);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "binance", ETHUSDT: "binance", TOTAL2: "synthetic" });
  });

  it("une republication du catalogue ne resonde pas un favori confirmé", async () => {
    watchlistStore.getState().setAll(["BTCUSDT", "CARDSUSDT"], { BTCUSDT: "binance" });
    const initial = spot(["binance", "BTCUSDT"], ["okx", "CARDSUSDT"]);
    const { publier } = catalogue(initial);
    const urls = reseau();
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    expect(urls).toEqual([OKX("CARDS-USDT")]);
    publier({ ...initial, instruments: [...initial.instruments] });
    publier({ ...initial, instruments: [...initial.instruments] });
    await vi.advanceTimersByTimeAsync(0);
    expect(urls).toHaveLength(1);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "binance", CARDSUSDT: "okx" });
  });

  it("un favori sans prix est resondé seul, à la republication et toutes les 30 s, jusqu'à son prix", async () => {
    watchlistStore.getState().setAll(["BTCUSDT", "CARDSUSDT"], { BTCUSDT: "binance" });
    const initial = spot(["binance", "BTCUSDT"], ["okx", "CARDSUSDT"]);
    const { publier } = catalogue(initial);
    const sansPrix = new Set(["okx:CARDSUSDT"]);
    const urls = reseau(sansPrix);
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    const cards = () => urls.filter((url) => url.includes("instId=CARDS-USDT")).length;
    expect(cards()).toBe(1);
    publier({ ...initial });
    await vi.advanceTimersByTimeAsync(0);
    expect(cards()).toBe(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(cards()).toBe(3);
    sansPrix.clear();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(cards()).toBe(4);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(cards()).toBe(4);
    expect(urls.every((url) => url === OKX("CARDS-USDT"))).toBe(true);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "binance", CARDSUSDT: "okx" });
  });

  it.each([["binance:HYPEUSDT enregistré", { HYPEUSDT: "binance" }], ["HYPEUSDT ajouté sans source", {}]] as const)(
    "%s passe sur Bybit (historique depuis 2025-07-11) après un vrai prix Bybit, dès la première session",
    async (_cas, sources) => {
      watchlistStore.getState().setAll(["HYPEUSDT"], sources);
      catalogue(HYPE());
      profondeurs(P_HYPE);
      const urls = reseau();
      stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
      await vi.advanceTimersByTimeAsync(0);
      expect(watchlistStore.getState().sources).toEqual({ HYPEUSDT: "bybit" });
      expect(urls).toEqual([BYBIT]);
      // Bybit, désormais en tête et listé : plus aucune sonde de la session.
      await vi.advanceTimersByTimeAsync(90_000);
      expect(urls).toHaveLength(1);
    },
  );

  it("un résultat du screener entre sans source et se classe comme tout favori : HYPEUSDT → Bybit", async () => {
    ajouterAWatchlist("HYPEUSDT");
    expect(watchlistStore.getState().sources).toEqual({});
    catalogue(HYPE());
    profondeurs(P_HYPE);
    const urls = reseau();
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSDT: "bybit" });
    expect(urls).toEqual([BYBIT]);
  });

  it("okx:BTCUSDT revient à Binance (profondeur équivalente, Binance départage) ; okx:CARDSUSDT, absent de Binance, reste sur OKX sans sonde", async () => {
    watchlistStore.getState().setAll(["BTCUSDT", "CARDSUSDT"], { BTCUSDT: "okx", CARDSUSDT: "okx" });
    catalogue(spot(["binance", "BTCUSDT"], ["okx", "BTCUSDT"], ["okx", "CARDSUSDT"]));
    profondeurs(P_BTC);
    const urls = reseau();
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "binance", CARDSUSDT: "okx" });
    expect(urls).toEqual([BINANCE("BTCUSDT")]);
  });

  it("binance:HYPEUSDT sans prix Bybit : la place suivante du classement (OKX) confirme la migration", async () => {
    watchlistStore.getState().setAll(["HYPEUSDT"], { HYPEUSDT: "binance" });
    catalogue(HYPE());
    profondeurs(P_HYPE);
    const urls = reseau(new Set(["bybit:HYPEUSDT"]));
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    expect(urls).toEqual([BYBIT, OKX("HYPE-USDT")]);
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSDT: "okx" });
  });

  it("okx:HYPEUSDT sans aucun prix : Binance, classé sous OKX, n'est jamais sondé ; OKX conservé puis confirmé par son prix", async () => {
    watchlistStore.getState().setAll(["HYPEUSDT"], { HYPEUSDT: "okx" });
    catalogue(HYPE());
    profondeurs(P_HYPE);
    const sansPrix = new Set(["bybit:HYPEUSDT", "okx:HYPEUSDT"]);
    const urls = reseau(sansPrix);
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    expect(urls).toEqual([BYBIT, OKX("HYPE-USDT")]);
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSDT: "okx" });
    // Non confirmé : réessayé à 30 s, toujours jusqu'à OKX inclus.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(urls).toEqual([BYBIT, OKX("HYPE-USDT"), BYBIT, OKX("HYPE-USDT")]);
    sansPrix.delete("okx:HYPEUSDT");
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(urls).toHaveLength(6);
    expect(urls.some((url) => url.includes("binance"))).toBe(false);
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSDT: "okx" });
  });

  it("sans prix Binance, okx:BTCUSDT garde sa place d'origine ; Kraken, classé sous elle, n'est jamais sondé", async () => {
    watchlistStore.getState().setAll(["BTCUSDT"], { BTCUSDT: "okx" });
    catalogue(spot(["binance", "BTCUSDT"], ["kraken", "BTCUSDT"], ["okx", "BTCUSDT"]));
    profondeurs({ ...P_BTC, "kraken:BTCUSDT": P_BTC["binance:BTCUSDT"] });
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      urls.push(String(input));
      if (String(input).startsWith("https://api.kraken.com/")) return reponse({ error: [], result: { XBTUSDT: { c: ["60000"], o: "59000" } } });
      if (String(input).startsWith("https://www.okx.com/")) return reponse({ code: "0", data: [{ instType: "SPOT", instId: "BTC-USDT", last: "60000" }] });
      return new Response("{}", { status: 503 });
    }));
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "okx" });
    expect(urls).toEqual([BINANCE("BTCUSDT"), OKX("BTC-USDT")]);
  });

  it.each([
    ["binance:ETHUSDT (profondeur inconnue, Binance départage)", "ETHUSDT", "binance", spot(["binance", "ETHUSDT"], ["kraken", "ETHUSDT"], ["okx", "ETHUSDT"]), {}],
    ["bybit:HYPEUSDT (la plus profonde)", "HYPEUSDT", "bybit", HYPE(), P_HYPE],
    ["okx:CARDSUSDT (Kraken à égalité, provenance)", "CARDSUSDT", "okx", spot(["kraken", "CARDSUSDT"], ["okx", "CARDSUSDT"]), {}],
  ] as const)("%s en tête de son classement et listée : confirmée sans sonde, son ticker en panne ne la déplace pas", async (_cas, symbol, source, courant, table) => {
    watchlistStore.getState().setAll([symbol], { [symbol]: source });
    catalogue(courant);
    profondeurs(table);
    const urls = reseau(new Set([`${source}:${symbol}`]));
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(90_000);
    expect(watchlistStore.getState().sources).toEqual({ [symbol]: source });
    expect(urls).toEqual([]);
  });

  it("mesure partielle : bybit:HYPEUSDT mesuré, Binance inconnu — le bénéfice du doute ne déplace pas le favori", async () => {
    // Sonde Binance échouée ou encore en file : Binance garde la tête du classement (départage),
    // mais sans mesure il ne prouve pas plus d'historique que Bybit.
    watchlistStore.getState().setAll(["HYPEUSDT"], { HYPEUSDT: "bybit" });
    catalogue(HYPE());
    profondeurs({ "bybit:HYPEUSDT": P_HYPE["bybit:HYPEUSDT"], "okx:HYPEUSDT": P_HYPE["okx:HYPEUSDT"] });
    const urls = reseau();
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(90_000);
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSDT: "bybit" });
    expect(urls).toEqual([]);
  });

  it.each([
    ["binance:HYPEUSDT reste sur Binance, sans sonde", { HYPEUSDT: "binance" }, "binance", []],
    ["okx:HYPEUSDT, gardé sans sonde, revient à Binance après son prix", { HYPEUSDT: "okx" }, "okx", [BINANCE("HYPEUSDT")]],
    ["HYPEUSDT sans source part sur Binance, d'abord à titre provisoire", {}, "binance", [BINANCE("HYPEUSDT")]],
  ] as const)("toutes les sondes de profondeur en échec : 5 min sans décision (10 réessais), puis comportement d'avant : %s", async (_cas, sources, pendant, attendues) => {
    watchlistStore.getState().setAll(["HYPEUSDT"], sources);
    catalogue(HYPE());
    const urls = reseau();
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1_000);
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSDT: pendant });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSDT: "binance" });
    expect(urls).toEqual(attendues);
  });

  it("mesure de profondeur lente (4 s, cache froid), pas en échec : bybit:HYPEUSDT l'attend et reste sur Bybit d'une session à l'autre, sans sonde Binance", async () => {
    watchlistStore.getState().setAll(["HYPEUSDT"], { HYPEUSDT: "bybit" });
    catalogue(HYPE());
    mesureLente(P_HYPE, 4_000);
    const urls = reseau();
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(20_000);
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSDT: "bybit" });
    stop();
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(20_000);
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSDT: "bybit" });
    expect(urls).toEqual([]);
  });

  it.each([
    ["mesurée à 20 s : Bybit confirmé au réessai, sans sonde", P_HYPE, "bybit", []],
    ["en échec à 20 s : Binance départage au bout de 5 min (10 réessais), comme avant", {}, "binance", [BINANCE("HYPEUSDT")]],
  ] as const)("mesure au-delà de l'attente (15 s), bybit:HYPEUSDT et Binance inconnus : aucune décision sur ce doute ; %s", async (_cas, mesures, attendue, sondes) => {
    watchlistStore.getState().setAll(["HYPEUSDT"], { HYPEUSDT: "bybit" });
    catalogue(HYPE());
    mesureLente(mesures, 20_000);
    const urls = reseau();
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(29_000);
    expect(urls).toEqual([]);
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSDT: "bybit" });
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSDT: attendue });
    expect(urls).toEqual(sondes);
  });

  it("binance:HYPEUSDT, mesure Bybit en échec une fois puis réussie : ni OKX ni confirmation sur ce doute, Bybit au passage suivant", async () => {
    watchlistStore.getState().setAll(["HYPEUSDT"], { HYPEUSDT: "binance" });
    catalogue(HYPE());
    // Sonde Bybit en échec (inconnue 60 s) : Binance et OKX seuls mesurés.
    const table: Record<string, number> = { "binance:HYPEUSDT": P_HYPE["binance:HYPEUSDT"], "okx:HYPEUSDT": P_HYPE["okx:HYPEUSDT"] };
    profondeurs(table);
    const urls = reseau();
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    // Bybit, inconnu, peut être le plus profond : Binance gardé (son prix reste affiché), sans sonde.
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSDT: "binance" });
    expect(urls).toEqual([]);
    table["bybit:HYPEUSDT"] = P_HYPE["bybit:HYPEUSDT"];
    await vi.advanceTimersByTimeAsync(30_000);
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSDT: "bybit" });
    expect(urls).toEqual([BYBIT]);
    // Confirmé définitivement : plus aucune sonde de la session.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(urls).toHaveLength(1);
  });

  it("binance:HYPEUSDT, mesure Bybit toujours en échec : sans décision 5 min (10 réessais), puis OKX, le plus profond mesuré, est confirmé définitivement", async () => {
    watchlistStore.getState().setAll(["HYPEUSDT"], { HYPEUSDT: "binance" });
    catalogue(HYPE());
    profondeurs({ "binance:HYPEUSDT": P_HYPE["binance:HYPEUSDT"], "okx:HYPEUSDT": P_HYPE["okx:HYPEUSDT"] });
    const urls = reseau();
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1_000);
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSDT: "binance" });
    expect(urls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSDT: "okx" });
    expect(urls).toEqual([OKX("HYPE-USDT")]);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(urls).toHaveLength(1);
  });

  it.each([
    ["binance:HYPEUSDT enregistré, gardé sans sonde", { HYPEUSDT: "binance" }, []],
    ["HYPEUSDT sans source, prix Binance affiché à titre provisoire", {}, [BINANCE("HYPEUSDT")]],
  ] as const)("mesure Binance encore en vol après 15 s, Bybit et OKX mesurés : Binance, en tête au bénéfice du doute, n'est pas confirmé (%s) ; Bybit dès que la mesure Binance entre", async (_cas, sources, avant) => {
    watchlistStore.getState().setAll(["HYPEUSDT"], sources);
    catalogue(HYPE());
    const table: Record<string, number> = { "bybit:HYPEUSDT": P_HYPE["bybit:HYPEUSDT"], "okx:HYPEUSDT": P_HYPE["okx:HYPEUSDT"] };
    profondeurs(table);
    const urls = reseau();
    const session = nouvelleSessionProvenances();
    stop = suivreProvenancesFavoris(session);
    await vi.advanceTimersByTimeAsync(0);
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSDT: "binance" });
    expect(session.confirmees.has("HYPEUSDT")).toBe(false);
    expect(urls).toEqual(avant);
    // Sonde Binance finie à 20 s : sa semaine d'historique la classe sous Bybit.
    table["binance:HYPEUSDT"] = P_HYPE["binance:HYPEUSDT"];
    await vi.advanceTimersByTimeAsync(30_000);
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSDT: "bybit" });
    expect(urls).toEqual([...avant, BYBIT]);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(urls).toHaveLength(avant.length + 1);
  });

  it("binance:HYPEUSDT, mesure Binance toujours en échec, Bybit et OKX mesurés : 5 min sans confirmation (10 réessais), puis Binance confirmé définitivement, sans sonde", async () => {
    watchlistStore.getState().setAll(["HYPEUSDT"], { HYPEUSDT: "binance" });
    catalogue(HYPE());
    profondeurs({ "bybit:HYPEUSDT": P_HYPE["bybit:HYPEUSDT"], "okx:HYPEUSDT": P_HYPE["okx:HYPEUSDT"] });
    const urls = reseau();
    const session = nouvelleSessionProvenances();
    stop = suivreProvenancesFavoris(session);
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1_000);
    expect(session.confirmees.has("HYPEUSDT")).toBe(false);
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSDT: "binance" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.confirmees.get("HYPEUSDT")).toBe("binance");
    expect(session.doutes.size).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSDT: "binance" });
    expect(urls).toEqual([]);
  });

  it("HYPEUSDT ajouté sans source, toutes les mesures en échec : prix Binance affiché à titre provisoire, Bybit dès que sa mesure revient", async () => {
    watchlistStore.getState().setAll(["HYPEUSDT"]);
    catalogue(HYPE());
    const table: Record<string, number> = {};
    profondeurs(table);
    const urls = reseau();
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSDT: "binance" });
    expect(urls).toEqual([BINANCE("HYPEUSDT")]);
    Object.assign(table, P_HYPE);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSDT: "bybit" });
    expect(urls).toEqual([BINANCE("HYPEUSDT"), BYBIT]);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(urls).toHaveLength(2);
  });

  it("des ajouts rapprochés (une passe chacun) n'écourtent pas les 5 min de doute de binance:HYPEUSDT", async () => {
    watchlistStore.getState().setAll(["HYPEUSDT"], { HYPEUSDT: "binance" });
    catalogue(HYPE());
    profondeurs({ "binance:HYPEUSDT": P_HYPE["binance:HYPEUSDT"], "okx:HYPEUSDT": P_HYPE["okx:HYPEUSDT"] });
    const urls = reseau();
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    for (const symbol of ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "DOTUSDT", "LTCUSDT", "TRXUSDT"]) {
      watchlistStore.getState().add(symbol, "binance");
      await vi.advanceTimersByTimeAsync(1_000);
    }
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(watchlistStore.getState().sources.HYPEUSDT).toBe("binance");
    expect(urls.some((url) => url.includes("HYPE"))).toBe(false);
  });

  it("un remontage (plein écran) ne remet pas à zéro les 5 min de doute d'un favori", async () => {
    watchlistStore.getState().setAll(["HYPEUSDT"], { HYPEUSDT: "binance" });
    catalogue(HYPE());
    profondeurs({ "binance:HYPEUSDT": P_HYPE["binance:HYPEUSDT"], "okx:HYPEUSDT": P_HYPE["okx:HYPEUSDT"] });
    const urls = reseau();
    const session = nouvelleSessionProvenances();
    stop = suivreProvenancesFavoris(session);
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    stop();
    stop = suivreProvenancesFavoris(session);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSDT: "okx" });
    expect(urls).toEqual([OKX("HYPE-USDT")]);
  });

  it("binance:HYPEUSDT retiré pendant son doute (Bybit sans mesure) puis rajouté 2 min plus tard : 5 min de doute complètes, pas une fenêtre déjà échue", async () => {
    watchlistStore.getState().setAll(["HYPEUSDT"], { HYPEUSDT: "binance" });
    catalogue(HYPE());
    profondeurs({ "binance:HYPEUSDT": P_HYPE["binance:HYPEUSDT"], "okx:HYPEUSDT": P_HYPE["okx:HYPEUSDT"] });
    const urls = reseau();
    const session = nouvelleSessionProvenances();
    stop = suivreProvenancesFavoris(session);
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(session.doutes.has("HYPEUSDT")).toBe(true);
    watchlistStore.getState().remove("HYPEUSDT");
    expect(session.doutes.has("HYPEUSDT")).toBe(false);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    watchlistStore.getState().add("HYPEUSDT", "binance");
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1_000);
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSDT: "binance" });
    expect(urls).toEqual([]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSDT: "okx" });
    expect(urls).toEqual([OKX("HYPE-USDT")]);
  });

  it("un favori retiré pendant le démontage (plein écran) oublie son doute au remontage ; celui d'un favori resté est gardé", async () => {
    const session = nouvelleSessionProvenances();
    session.doutes.set("HYPEUSDT", Date.now() - 4 * 60_000);
    session.doutes.set("VIRTUALUSDT", Date.now() - 4 * 60_000);
    watchlistStore.getState().setAll(["VIRTUALUSDT"], { VIRTUALUSDT: "okx" });
    catalogue(spot(["binance", "VIRTUALUSDT"], ["okx", "VIRTUALUSDT"]));
    reseau();
    stop = suivreProvenancesFavoris(session);
    expect([...session.doutes.keys()]).toEqual(["VIRTUALUSDT"]);
  });

  it("catalogue Binance indisponible : un favori Binance n'est sondé que sur Binance, sa source ne change jamais", async () => {
    watchlistStore.getState().setAll(["BTCUSDT"], { BTCUSDT: "binance" });
    const { publier } = catalogue({ ...spot(["kraken", "BTCUSDT"], ["okx", "BTCUSDT"]), unavailableSources: ["binance"] });
    profondeurs({ ...P_BTC, "kraken:BTCUSDT": P_BTC["binance:BTCUSDT"] });
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      urls.push(String(input));
      if (String(input).startsWith("https://api.kraken.com/")) return reponse({ error: [], result: { XBTUSDT: { c: ["60000"], o: "59000" } } });
      if (String(input).startsWith("https://www.okx.com/")) return reponse({ code: "0", data: [{ instType: "SPOT", instId: "BTC-USDT", last: "60000" }] });
      return new Response("{}", { status: 503 });
    }));
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "binance" });
    expect(urls).toEqual([BINANCE("BTCUSDT")]);
    // Sans prix Binance : non confirmé, réessayé à 30 s, toujours sur Binance seul.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(urls).toEqual(Array(2).fill(BINANCE("BTCUSDT")));
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "binance" });
    // Le catalogue Binance revenu le liste : confirmé sans sonde.
    publier(spot(["binance", "BTCUSDT"], ["kraken", "BTCUSDT"], ["okx", "BTCUSDT"]));
    await vi.advanceTimersByTimeAsync(90_000);
    expect(urls).toHaveLength(2);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "binance" });
  });

  it("panne passagère du catalogue Binance : les replis confirmés entre-temps sont reclassés à son retour (BTCUSDT y revient, VIRTUALUSDT après 5 min de doute, HYPEUSDT reste sur Bybit)", async () => {
    watchlistStore.getState().setAll(["BTCUSDT", "VIRTUALUSDT", "CARDSUSDT", "HYPEUSDT"], { BTCUSDT: "okx", VIRTUALUSDT: "okx", CARDSUSDT: "okx", HYPEUSDT: "bybit" });
    const panne = { ...spot(["bybit", "HYPEUSDT"], ["okx", "BTCUSDT"], ["okx", "VIRTUALUSDT"], ["okx", "CARDSUSDT"], ["okx", "HYPEUSDT"]), unavailableSources: ["binance" as const] };
    const { publier } = catalogue(panne);
    profondeurs({ ...P_HYPE, ...P_BTC });
    const urls = reseau();
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    // Chaque source enregistrée est en tête de son classement (Binance n'y est qu'un essai) : sans sonde.
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "okx", VIRTUALUSDT: "okx", CARDSUSDT: "okx", HYPEUSDT: "bybit" });
    expect(urls).toEqual([]);
    // Confirmations provisoires : catalogue partiel relu à chaque réessai (son rafraîchissement republie un retour de Binance).
    const lectures = vi.mocked(routing.fetchMarketCatalog).mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(vi.mocked(routing.fetchMarketCatalog).mock.calls.length).toBeGreaterThan(lectures);
    expect(urls).toEqual([]);
    // Binance republié : BTC (profondeur équivalente) y revient ; HYPE, plus profond sur Bybit, y
    // reste sans sonde ; CARDS, absent de Binance, reste sur OKX. VIRTUAL, sans aucune mesure, reste
    // sur OKX sans sonde 5 min (10 réessais), puis Binance départage, comme avant.
    publier(spot(["binance", "BTCUSDT"], ["binance", "VIRTUALUSDT"], ["binance", "HYPEUSDT"], ...panne.instruments.map((i): [ExchangeId, string] => [i.exchange, i.symbol])));
    await vi.advanceTimersByTimeAsync(0);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "binance", VIRTUALUSDT: "okx", CARDSUSDT: "okx", HYPEUSDT: "bybit" });
    expect(urls).toEqual([BINANCE("BTCUSDT")]);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "binance", VIRTUALUSDT: "binance", CARDSUSDT: "okx", HYPEUSDT: "bybit" });
    expect(urls.sort()).toEqual([BINANCE("BTCUSDT"), BINANCE("VIRTUALUSDT")]);
    // Catalogue complet : plus aucune relecture ni sonde.
    const apres = vi.mocked(routing.fetchMarketCatalog).mock.calls.length;
    await vi.advanceTimersByTimeAsync(90_000);
    expect(vi.mocked(routing.fetchMarketCatalog).mock.calls.length).toBe(apres);
    expect(urls).toHaveLength(2);
  });

  it("catalogue Binance en panne : l'essai spéculatif Binance, jamais mesuré ici, ne tient pas okx:CARDSUSDT en doute", async () => {
    watchlistStore.getState().setAll(["CARDSUSDT"], { CARDSUSDT: "okx" });
    catalogue({ ...spot(["okx", "CARDSUSDT"]), unavailableSources: ["binance"] });
    const urls = reseau();
    const session = nouvelleSessionProvenances();
    stop = suivreProvenancesFavoris(session);
    await vi.advanceTimersByTimeAsync(0);
    expect(session.confirmees.get("CARDSUSDT")).toBe("okx");
    expect(session.doutes.size).toBe(0);
    expect(urls).toEqual([]);
  });

  it("place hors Binance en échec durable, favoris confirmés : aucune relecture du catalogue après le démarrage", async () => {
    // Bybit en 403 (ou MEXC sans proxy) : relire toutes les 30 s relançait Bybit et, à chaque fin de
    // cache (5 min), retéléchargeait les ~7,5 Mo des catalogues sains, sans rien à rendre à Binance.
    watchlistStore.getState().setAll(["BTCUSDT", "ETHUSDT"], { BTCUSDT: "binance", ETHUSDT: "binance" });
    catalogue({ ...spot(["binance", "BTCUSDT"], ["binance", "ETHUSDT"]), unavailableSources: ["bybit"] });
    const urls = reseau();
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    const lectures = vi.mocked(routing.fetchMarketCatalog).mock.calls.length;
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect(vi.mocked(routing.fetchMarketCatalog).mock.calls.length).toBe(lectures);
    expect(lectures).toBe(1);
    expect(urls).toEqual([]);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "binance", ETHUSDT: "binance" });
  });

  it("graphe prêt sur OKX pendant la panne du catalogue Binance : confirmation provisoire, levée au retour de Binance", async () => {
    watchlistStore.getState().setAll(["BTCUSDT"], { BTCUSDT: "okx" });
    const { publier } = catalogue({ ...spot(["okx", "BTCUSDT"]), unavailableSources: ["binance"] });
    profondeurs(P_BTC);
    const urls = reseau();
    const session = nouvelleSessionProvenances();
    stop = suivreProvenancesFavoris(session);
    await vi.advanceTimersByTimeAsync(0);
    graphePret("okx", "BTCUSDT");
    marketStore.getState().setMarket({ exchange: "binance", symbol: "XRPUSDT", timeframe: "1h" });
    // Remontage (plein écran) avant le retour de Binance : la confirmation reste provisoire.
    stop();
    stop = suivreProvenancesFavoris(session);
    await vi.advanceTimersByTimeAsync(0);
    publier(spot(["binance", "BTCUSDT"], ["okx", "BTCUSDT"]));
    await vi.advanceTimersByTimeAsync(0);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "binance" });
    expect(urls.filter((url) => url.includes("binance"))).toEqual([BINANCE("BTCUSDT")]);
  });

  it("provenance Binance démentie par son catalogue (CARDSUSDT absent) : réparée vers la place qui le liste", async () => {
    watchlistStore.getState().setAll(["CARDSUSDT"], { CARDSUSDT: "binance" });
    catalogue(spot(["binance", "BTCUSDT"], ["okx", "CARDSUSDT"]));
    const urls = reseau();
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    expect(watchlistStore.getState().sources).toEqual({ CARDSUSDT: "okx" });
    expect(urls).toEqual([OKX("CARDS-USDT")]);
  });

  it("paire Binance suspendue (absente de son catalogue TRADING, ticker REST figé) : le favori passe sur la place qui la cote, sans sonde Binance", async () => {
    // LRCUSDT réel (2026-09-24) : suspendue chez Binance, dont /ticker/24hr répond encore 200
    // avec un prix figé (ici le bouchon Binance, qui cote tout symbole) ; OKX la cote en direct.
    watchlistStore.getState().setAll(["LRCUSDT"], { LRCUSDT: "binance" });
    catalogue(spot(["binance", "BTCUSDT"], ["okx", "LRCUSDT"]));
    const urls = reseau();
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    expect(watchlistStore.getState().sources).toEqual({ LRCUSDT: "okx" });
    expect(urls).toEqual([OKX("LRC-USDT")]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(urls.some((url) => url.includes("api.binance.com"))).toBe(false);
  });

  it("une source confirmée, changée hors de la watchlist sans changer la liste, est resondée", async () => {
    watchlistStore.getState().setAll(["BTCUSDT"], { BTCUSDT: "binance" });
    catalogue(spot(["binance", "BTCUSDT"], ["okx", "BTCUSDT"]));
    profondeurs(P_BTC);
    const urls = reseau();
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    expect(urls).toEqual([]);
    // Ce que fait hydrateWatchlist() à la réconciliation daemon : un setState direct.
    watchlistStore.setState({ sources: { BTCUSDT: "okx" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "binance" });
    expect(urls).toEqual([BINANCE("BTCUSDT")]);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(urls).toHaveLength(1);
  });

  it("une confirmation interne (graphe prêt sur Bybit, en tête pour un favori HYPEUSDT sans source) ne relance pas les sondes en vol", async () => {
    watchlistStore.getState().setAll(["HYPEUSDT", "ETHUSDT"]);
    catalogue(spot(...HYPE().instruments.map((i): [ExchangeId, string] => [i.exchange, i.symbol]), ["binance", "ETHUSDT"]));
    profondeurs(P_HYPE);
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    graphePret("bybit", "HYPEUSDT");
    await vi.advanceTimersByTimeAsync(0);
    const appels = vi.mocked(fetch).mock.calls as unknown as Array<[string, RequestInit]>;
    expect(appels.map(([url]) => url).sort()).toEqual([BINANCE("ETHUSDT"), BYBIT]);
    expect(appels.every(([, init]) => init.signal?.aborted === false)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSDT: "bybit" });
  });

  it("graphe prêt sur une autre place (HYPEUSD OKX en 1d) : la source enregistrée (Coinbase, la plus profonde en 1h) n'est jamais écrasée", async () => {
    watchlistStore.getState().setAll(["HYPEUSD"], { HYPEUSD: "coinbase" });
    catalogue(spot(["kraken", "HYPEUSD"], ["coinbase", "HYPEUSD"], ["okx", "HYPEUSD"]));
    // Premières bougies relevées le 26/09/2026 ; OKX ne sert que ses 1 440 dernières bougies (60 j en
    // 1h), Kraken ses 720 (30 j en 1h) : OKX en tête en 1d, Coinbase en 1h.
    profondeurs({
      "okx:HYPEUSD": { "1d": date("2025-11-03"), "1h": date("2026-07-28") },
      "kraken:HYPEUSD": { "1d": date("2026-01-28"), "1h": date("2026-08-27") },
      "coinbase:HYPEUSD": date("2026-02-05"),
    });
    const urls = reseau();
    graphePret("okx", "HYPEUSD", "1d");
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSD: "coinbase" });
    // Nouveau chargement prêt sur OKX, favori déjà confirmé : toujours rien d'écrit.
    marketStore.getState().setMarket({ exchange: "binance", symbol: "XRPUSDT", timeframe: "1h" });
    graphePret("okx", "HYPEUSD", "1d");
    await vi.advanceTimersByTimeAsync(90_000);
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSD: "coinbase" });
    expect(urls).toEqual([]);
  });

  it("graphe prêt sur une autre place pendant la sonde : la sonde de la source enregistrée décide", async () => {
    watchlistStore.getState().setAll(["BTCUSDT"], { BTCUSDT: "okx" });
    catalogue(spot(["binance", "BTCUSDT"], ["bybit", "BTCUSDT"], ["okx", "BTCUSDT"]));
    profondeurs({ ...P_BTC, "bybit:BTCUSDT": P_BTC["binance:BTCUSDT"] });
    let repondre = () => {};
    vi.stubGlobal("fetch", vi.fn((input: string) => new Promise<Response>((resolve) => {
      repondre = () => resolve(reponse({ symbol: new URL(input).searchParams.get("symbol"), lastPrice: "60000", priceChangePercent: "1" }));
    })));
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledWith(BINANCE("BTCUSDT"), expect.anything());
    graphePret("bybit", "BTCUSDT");
    await vi.advanceTimersByTimeAsync(0);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "okx" });
    repondre();
    await vi.advanceTimersByTimeAsync(0);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "binance" });
  });

  it("graphe prêt sur la source enregistrée (binance:HYPEUSDT en 1s, propre à Binance, restauré) : ni au départ ni pendant la sonde il ne bloque la migration vers Bybit", async () => {
    watchlistStore.getState().setAll(["HYPEUSDT"], { HYPEUSDT: "binance" });
    catalogue(HYPE());
    profondeurs(P_HYPE);
    // Ticker Bybit en 1 s : le graphe redevient prêt sur Binance pendant la sonde.
    const urls = reseau(new Set(), abonnementRequis, 1_000);
    graphePret("binance", "HYPEUSDT", "1s");
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(500);
    expect(urls).toEqual([BYBIT]);
    graphePret("binance", "HYPEUSDT", "1m");
    await vi.advanceTimersByTimeAsync(90_000);
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSDT: "bybit" });
    expect(urls).toEqual([BYBIT]);
  });

  it("okx:HYPEUSDT sans aucun prix, graphe prêt sur OKX : Bybit, au-dessus, est sondé ; le graphe prouve ensuite OKX, confirmé sans réessai", async () => {
    watchlistStore.getState().setAll(["HYPEUSDT"], { HYPEUSDT: "okx" });
    catalogue(HYPE());
    profondeurs(P_HYPE);
    const urls = reseau(new Set(["bybit:HYPEUSDT", "okx:HYPEUSDT"]));
    graphePret("okx", "HYPEUSDT");
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(90_000);
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSDT: "okx" });
    expect(urls).toEqual([BYBIT, OKX("HYPE-USDT")]);
  });

  it("sans Binance au catalogue, okx:BTCUSDT garde sa place", async () => {
    watchlistStore.getState().setAll(["BTCUSDT"], { BTCUSDT: "okx" });
    catalogue(spot(["okx", "BTCUSDT"]));
    reseau();
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "okx" });
  });

  it("graphe prêt sur BTCUSDT chez Bybit, profondeur équivalente : Binance, en tête (départage), est retenu pour le favori sans source", async () => {
    watchlistStore.getState().setAll(["BTCUSDT"]);
    graphePret("bybit", "BTCUSDT");
    catalogue(spot(["binance", "BTCUSDT"], ["bybit", "BTCUSDT"]));
    profondeurs({ "binance:BTCUSDT": P_BTC["binance:BTCUSDT"], "bybit:BTCUSDT": P_BTC["binance:BTCUSDT"] });
    const urls = reseau();
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(90_000);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "binance" });
    expect(urls).toEqual([BINANCE("BTCUSDT")]);
  });

  it("sans source + graphe prêt sur binance:HYPEUSDT en 1s (propre à Binance) : Binance n'est pas en tête du classement 1h, le favori va sur Bybit", async () => {
    watchlistStore.getState().setAll(["BTCUSDT"], { BTCUSDT: "binance" });
    catalogue(spot(["binance", "BTCUSDT"], ...HYPE().instruments.map((i): [ExchangeId, string] => [i.exchange, i.symbol])));
    profondeurs(P_HYPE);
    const urls = reseau();
    graphePret("binance", "HYPEUSDT", "1s");
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    // Recherche → graphe → Ajouter : le favori entre sans source pendant que le graphe est prêt.
    watchlistStore.getState().add("HYPEUSDT");
    await vi.advanceTimersByTimeAsync(0);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "binance", HYPEUSDT: "bybit" });
    expect(urls).toEqual([BYBIT]);
  });

  it("favori HYPEUSDT sans source, graphe devenu prêt sur Binance en 1s pendant la sonde : il ne le confirme pas, Bybit l'emporte", async () => {
    watchlistStore.getState().setAll(["HYPEUSDT"]);
    catalogue(HYPE());
    profondeurs(P_HYPE);
    const urls = reseau(new Set(), abonnementRequis, 1_000);
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(500);
    graphePret("binance", "HYPEUSDT", "1s");
    await vi.advanceTimersByTimeAsync(0);
    expect(watchlistStore.getState().sources).toEqual({});
    await vi.advanceTimersByTimeAsync(90_000);
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSDT: "bybit" });
    expect(urls).toEqual([BYBIT]);
  });

  it("favori HYPEUSDT sans source, graphe prêt sur Binance en 1s, aucun ticker ne répond : la place du graphe, hors tête du classement 1h, n'est pas retenue ; Bybit à son retour", async () => {
    watchlistStore.getState().setAll(["HYPEUSDT"]);
    catalogue(HYPE());
    profondeurs(P_HYPE);
    const sansPrix = new Set(["binance:HYPEUSDT", "bybit:HYPEUSDT", "okx:HYPEUSDT"]);
    const urls = reseau(sansPrix);
    graphePret("binance", "HYPEUSDT", "1s");
    const session = nouvelleSessionProvenances();
    stop = suivreProvenancesFavoris(session);
    await vi.advanceTimersByTimeAsync(0);
    expect(urls).toEqual([BYBIT, OKX("HYPE-USDT"), BINANCE("HYPEUSDT")]);
    expect(watchlistStore.getState().sources).toEqual({});
    expect(session.confirmees.size).toBe(0);
    sansPrix.delete("bybit:HYPEUSDT");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSDT: "bybit" });
    expect(session.confirmees.get("HYPEUSDT")).toBe("bybit");
  });

  it("les ticks d'un graphe prêt (binance:HYPEUSDT en 1s, une bougie par seconde) ne relancent pas le classement d'un favori sans source", async () => {
    watchlistStore.getState().setAll(["HYPEUSDT"]);
    catalogue(HYPE());
    profondeurs(P_HYPE);
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    graphePret("binance", "HYPEUSDT", "1s");
    const classement = vi.spyOn(routing, "resolveMarketCandidates");
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(1_000);
    const avant = classement.mock.calls.length;
    for (let i = 1; i <= 10; i++) marketStore.getState().upsertCandle({ time: i * 1_000, open: 1, high: 1, low: 1, close: 1, volume: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(classement.mock.calls.length).toBe(avant);
    expect(watchlistStore.getState().sources).toEqual({});
  });

  it("graphe prêt sur HYPEUSDT chez Bybit, en tête du classement 1h : le favori sans source est confirmé sur Bybit, sans sonde", async () => {
    watchlistStore.getState().setAll(["HYPEUSDT"]);
    graphePret("bybit", "HYPEUSDT");
    catalogue(HYPE());
    profondeurs(P_HYPE);
    const urls = reseau();
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(90_000);
    expect(watchlistStore.getState().sources).toEqual({ HYPEUSDT: "bybit" });
    expect(urls).toEqual([]);
  });

  it("graphe devenu prêt sur bybit:HYPEUSDT, hors watchlist : ni classement, ni mesure, ni doute amorcé pour un ajout ultérieur", async () => {
    watchlistStore.getState().setAll(["BTCUSDT"], { BTCUSDT: "binance" });
    catalogue(spot(["binance", "BTCUSDT"], ...HYPE().instruments.map((i): [ExchangeId, string] => [i.exchange, i.symbol])));
    // OKX sans mesure : un classement de HYPEUSDT ouvrirait sa fenêtre de doute.
    profondeurs({ "binance:HYPEUSDT": P_HYPE["binance:HYPEUSDT"], "bybit:HYPEUSDT": P_HYPE["bybit:HYPEUSDT"] });
    const urls = reseau();
    const session = nouvelleSessionProvenances();
    stop = suivreProvenancesFavoris(session);
    await vi.advanceTimersByTimeAsync(0);
    const classement = vi.spyOn(routing, "resolveMarketCandidates");
    const mesures = vi.mocked(profondeur.mesurerProfondeurs).mock.calls.length;
    graphePret("bybit", "HYPEUSDT");
    await vi.advanceTimersByTimeAsync(0);
    expect(classement).not.toHaveBeenCalled();
    expect(vi.mocked(profondeur.mesurerProfondeurs).mock.calls.length).toBe(mesures);
    expect(session.doutes.size).toBe(0);
    expect(urls).toEqual([]);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "binance" });
  });

  it("graphe devenu prêt sur bybit:HYPEUSDT, favori sans source d'un autre groupe : Bybit, en tête du classement 1h, est retenu comme avant", async () => {
    watchlistStore.getState().setAll(["BTCUSDT"], { BTCUSDT: "binance" });
    watchlistStore.getState().addGroup("Alts");
    watchlistStore.getState().add("HYPEUSDT");
    watchlistStore.getState().setActiveGroup(PRINCIPAL_GROUP_ID);
    catalogue(spot(["binance", "BTCUSDT"], ...HYPE().instruments.map((i): [ExchangeId, string] => [i.exchange, i.symbol])));
    profondeurs(P_HYPE);
    const urls = reseau();
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    graphePret("bybit", "HYPEUSDT");
    await vi.advanceTimersByTimeAsync(0);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "binance", HYPEUSDT: "bybit" });
    expect(urls).toEqual([]);
  });

  it("les sondes des favoris mesurent au rang des favoris (derrière le graphe) et sont abandonnées à l'arrêt", async () => {
    watchlistStore.getState().setAll(["HYPEUSDT"], { HYPEUSDT: "binance" });
    catalogue(HYPE());
    profondeurs(P_HYPE);
    reseau();
    const classement = vi.spyOn(routing, "resolveMarketCandidates");
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    const mesures = vi.mocked(profondeur.mesurerProfondeurs).mock.calls;
    const directe = mesures.find(([, delai]) => delai === 15_000);
    expect(directe?.[2]).toEqual({ priorite: "favoris", signal: expect.any(AbortSignal) });
    expect(classement.mock.calls.length).toBeGreaterThan(0);
    expect(classement.mock.calls.every(([, , options]) => options?.priorite === "favoris")).toBe(true);
    const signal = directe?.[2]?.signal;
    expect(signal?.aborted).toBe(false);
    stop();
    expect(signal?.aborted).toBe(true);
  });

  it("un remontage (sortie du plein écran) ne resonde aucun favori confirmé de la session", async () => {
    watchlistStore.getState().setAll(["LINKUSDT", "CARDSUSDT"]);
    catalogue(spot(["binance", "LINKUSDT"], ["okx", "CARDSUSDT"]));
    const urls = reseau();
    // Session par défaut, au niveau du module : celle que le composant garde d'un montage à l'autre.
    stop = suivreProvenancesFavoris();
    await vi.advanceTimersByTimeAsync(0);
    expect(urls.sort()).toEqual([BINANCE("LINKUSDT"), OKX("CARDS-USDT")]);
    stop();
    stop = suivreProvenancesFavoris();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(urls).toHaveLength(2);
    expect(watchlistStore.getState().sources).toEqual({ LINKUSDT: "binance", CARDSUSDT: "okx" });
  });

  it("Twelve Data sans source : sondé au montage et aux changements de liste, jamais au réessai ni au catalogue", async () => {
    vi.setSystemTime(new Date("2026-09-23T14:00:00Z")); // mercredi : forex ouvert
    watchlistStore.getState().setAll(["WTI/USD", "CARDSUSDT"]);
    const initial = spot(["okx", "CARDSUSDT"], ["binance", "ETHUSDT"]);
    const { publier } = catalogue(initial);
    // CARDS reste sans prix : le réessai crypto à 30 s tourne pendant tout le test.
    const urls = reseau(new Set(["okx:CARDSUSDT"]));
    const quotes = () => urls.filter((url) => url.startsWith("/tdapi/quote?"));
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    expect(quotes()).toEqual(["/tdapi/quote?symbol=WTI%2FUSD"]);
    for (let i = 0; i < 3; i++) publier({ ...initial, instruments: [...initial.instruments] });
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(quotes()).toHaveLength(1);
    expect(urls.filter((url) => url.includes("instId=CARDS-USDT")).length).toBeGreaterThan(100);
    watchlistStore.getState().add("ETHUSDT");
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(quotes()).toHaveLength(2);
    expect(watchlistStore.getState().sources).toEqual({ ETHUSDT: "binance" });
  });

  it("une sonde Twelve Data en vol n'est pas doublée par un changement de liste", async () => {
    vi.setSystemTime(new Date("2026-09-23T14:00:00Z"));
    watchlistStore.getState().setAll(["WTI/USD"]);
    catalogue(spot(["binance", "ETHUSDT"]));
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn((input: string) => {
      urls.push(String(input));
      // Réponse Twelve Data qui ne revient pas : la sonde reste en vol.
      if (String(input).startsWith("/tdapi/")) return new Promise<Response>(() => {});
      return Promise.resolve(reponse({ symbol: "ETHUSDT", lastPrice: "3000", priceChangePercent: "1" }));
    }));
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    watchlistStore.getState().add("ETHUSDT");
    await vi.advanceTimersByTimeAsync(0);
    expect(urls.sort()).toEqual(["/tdapi/quote?symbol=WTI%2FUSD", BINANCE("ETHUSDT")]);
  });

  it("un actif TradFi sans prix n'est pas resondé au remontage, mais l'est au changement de liste", async () => {
    vi.setSystemTime(new Date("2026-09-23T14:00:00Z"));
    watchlistStore.getState().setAll(["WTI/USD"]);
    catalogue(spot(["binance", "ETHUSDT"]));
    const urls = reseau();
    const quotes = () => urls.filter((url) => url.startsWith("/tdapi/quote?"));
    const session = nouvelleSessionProvenances();
    stop = suivreProvenancesFavoris(session);
    await vi.advanceTimersByTimeAsync(0);
    expect(quotes()).toHaveLength(1);
    stop();
    stop = suivreProvenancesFavoris(session);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(quotes()).toHaveLength(1);
    watchlistStore.getState().add("ETHUSDT");
    await vi.advanceTimersByTimeAsync(0);
    expect(quotes()).toHaveLength(2);
  });

  it("un remontage pendant une sonde Twelve Data en vol ne la double pas ; sa réponse sert la session", async () => {
    vi.setSystemTime(new Date("2026-10-07T14:00:00Z")); // mercredi, forex ouvert ; fenêtre 8/min neuve
    watchlistStore.getState().setAll(["WTI/USD"]);
    catalogue(spot(["binance", "ETHUSDT"]));
    const urls: string[] = [];
    let repondre = () => {};
    vi.stubGlobal("fetch", vi.fn((input: string) => {
      urls.push(String(input));
      return new Promise<Response>((resolve) => { repondre = () => resolve(reponse({ close: "75", percent_change: "1" })); });
    }));
    const session = nouvelleSessionProvenances();
    stop = suivreProvenancesFavoris(session);
    await vi.advanceTimersByTimeAsync(0);
    expect(urls).toEqual(["/tdapi/quote?symbol=WTI%2FUSD"]);
    // Sortie du plein écran : démontage puis remontage, la sonde est toujours en vol.
    stop();
    stop = suivreProvenancesFavoris(session);
    await vi.advanceTimersByTimeAsync(0);
    expect(urls).toHaveLength(1);
    repondre();
    await vi.advanceTimersByTimeAsync(0);
    expect(watchlistStore.getState().sources).toEqual({ "WTI/USD": "twelvedata" });
    await vi.advanceTimersByTimeAsync(90_000);
    expect(urls).toHaveLength(1);
  });

  it("marché fermé (samedi) : aucune requête Twelve Data, ni au montage ni ensuite", async () => {
    vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
    watchlistStore.getState().setAll(["WTI/USD", "AAPL", "EUR/USD"]);
    catalogue(spot());
    const urls = reseau(new Set(), () => ({ close: "100", percent_change: "1" }));
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(urls).toEqual([]);
    expect(watchlistStore.getState().sources).toEqual({});
  });

  it("un actif TradFi ajouté marché fermé est sondé une seule fois, à l'ouverture de son marché", async () => {
    vi.setSystemTime(new Date("2026-09-26T12:00:00Z")); // samedi
    watchlistStore.getState().setAll(["AAPL", "WTI/USD"]);
    catalogue(spot());
    const urls = reseau(new Set(), (url) => url.includes("AAPL") ? { close: "230", percent_change: "1" } : abonnementRequis());
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    expect(urls).toEqual([]);
    // Dimanche 23:00Z : le forex a rouvert (22:00Z), la bourse US reste fermée.
    await vi.advanceTimersByTimeAsync(Date.parse("2026-09-27T23:00:00Z") - Date.now());
    expect(urls).toEqual(["/tdapi/quote?symbol=WTI%2FUSD"]);
    // Lundi 14:00Z : séance US ouverte depuis 13:20Z.
    await vi.advanceTimersByTimeAsync(Date.parse("2026-09-28T14:00:00Z") - Date.now());
    expect(urls).toEqual(["/tdapi/quote?symbol=WTI%2FUSD", "/tdapi/quote?symbol=AAPL"]);
    expect(watchlistStore.getState().sources).toEqual({ AAPL: "twelvedata" });
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    expect(urls).toHaveLength(2);
  });

  it("une source Twelve Data enregistrée n'est jamais sondée, remontage compris : les quotes la servent", async () => {
    vi.setSystemTime(new Date("2026-09-23T14:00:00Z")); // mercredi, séance US ouverte
    watchlistStore.getState().setAll(["SPY", "AAPL"], { SPY: "twelvedata", AAPL: "twelvedata" });
    catalogue(spot());
    const urls = reseau();
    const session = nouvelleSessionProvenances();
    stop = suivreProvenancesFavoris(session);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    stop = suivreProvenancesFavoris(session);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(urls).toEqual([]);
    expect(watchlistStore.getState().sources).toEqual({ SPY: "twelvedata", AAPL: "twelvedata" });
  });

  it("une confirmation démentie pendant le démontage est oubliée au remontage, sans sonde doublée", async () => {
    // ETHUSDT, confirmé plus tôt dans la session, a été retiré puis rajouté : il n'a plus de source.
    const session = nouvelleSessionProvenances();
    session.confirmees.set("ETHUSDT", "binance");
    watchlistStore.getState().setAll(["BTCUSDT", "ETHUSDT"]);
    catalogue(spot(["binance", "BTCUSDT"], ["binance", "ETHUSDT"]));
    const urls = reseau();
    stop = suivreProvenancesFavoris(session);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(urls.sort()).toEqual([
      BINANCE("BTCUSDT"),
      BINANCE("ETHUSDT"),
    ]);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "binance", ETHUSDT: "binance" });
  });

  it("un favori ajouté est sondé seul ; l'arrêt annule la sonde en vol", async () => {
    watchlistStore.getState().setAll(["BTCUSDT"], { BTCUSDT: "binance" });
    catalogue(spot(["binance", "BTCUSDT"], ["binance", "ETHUSDT"], ["binance", "SOLUSDT"]));
    const urls = reseau();
    stop = suivreProvenancesFavoris(nouvelleSessionProvenances());
    await vi.advanceTimersByTimeAsync(0);
    watchlistStore.getState().add("ETHUSDT");
    await vi.advanceTimersByTimeAsync(0);
    expect(urls).toEqual([BINANCE("ETHUSDT")]);
    expect(watchlistStore.getState().sources).toEqual({ BTCUSDT: "binance", ETHUSDT: "binance" });
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    watchlistStore.getState().add("SOLUSDT");
    await vi.advanceTimersByTimeAsync(0);
    const enVol = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
    stop();
    expect(enVol[1].signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
