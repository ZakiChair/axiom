/**
 * Profondeur d'historique par place : sondes via les adaptateurs (espionnés, aucun réseau),
 * cache mémoire + localStorage bouchonné, file par place. Horloge figée au 26/09/2026.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Candle, ExchangeId, IExchangeAdapter } from "@axiom/types";

const JOUR = 86_400_000;
const SEMAINE = 7 * JOUR;
const MAINTENANT = Date.parse("2026-09-26T08:00:00Z");
const CLE = "axiom:profondeurHistorique:v1";
const date = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const bougie = (time: number): Candle => ({ time, open: 1, high: 1, low: 1, close: 1, volume: 1 });
/** `n` bougies croissantes, la première à `debut`. */
const serie = (debut: number, n: number, pas = SEMAINE) => Array.from({ length: n }, (_, i) => bougie(debut + i * pas));
function differee<T>() {
  let resoudre!: (valeur: T) => void;
  let rejeter!: (erreur: unknown) => void;
  const promesse = new Promise<T>((ok, ko) => { resoudre = ok; rejeter = ko; });
  return { promesse, resoudre, rejeter };
}

let stockage: Map<string, string>;
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(MAINTENANT);
  stockage = new Map();
  vi.stubGlobal("localStorage", { getItem: (cle: string) => stockage.get(cle) ?? null, setItem: (cle: string, valeur: string) => { stockage.set(cle, valeur); } });
  // Garde-fou : toute sonde passe par un adaptateur espionné, jamais par le réseau.
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("réseau interdit en test"))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

/** Module neuf (cache vide) et espion de `fetchKlines` par place. */
async function charger() {
  const { getAdapter } = await import("./adapters");
  const profondeur = await import("./profondeurHistorique");
  const sonde = (place: ExchangeId, impl: IExchangeAdapter["fetchKlines"]) => vi.spyOn(getAdapter(place), "fetchKlines").mockImplementation(impl);
  return { profondeur, sonde };
}
const persiste = () => JSON.parse(stockage.get(CLE) ?? "null") as { v: number; e: Record<string, [number, number, number]> } | null;

describe("sondes de profondeur par place", () => {
  it("Binance, Bybit et MEXC : 1w par 1 000 ; exact sous la limite, borne à la limite", async () => {
    const { profondeur, sonde } = await charger();
    const binance = sonde("binance", async () => serie(date("2026-09-24"), 1));
    const bybit = sonde("bybit", async () => serie(date("2025-07-11"), 64));
    const mexc = sonde("mexc", async () => serie(MAINTENANT - 999 * SEMAINE, 1_000));
    await profondeur.mesurerProfondeurs([
      { exchange: "binance", symbol: "HYPEUSDT" }, { exchange: "bybit", symbol: "HYPEUSDT" }, { exchange: "mexc", symbol: "BTCUSDT" },
    ]);
    expect(binance).toHaveBeenCalledWith("HYPEUSDT", "1w", { limit: 1_000 });
    expect(bybit).toHaveBeenCalledWith("HYPEUSDT", "1w", { limit: 1_000 });
    expect(mexc).toHaveBeenCalledWith("BTCUSDT", "1w", { limit: 1_000 });
    expect(profondeur.lireProfondeur("binance", "HYPEUSDT")).toEqual({ debut: date("2026-09-24"), exact: true });
    expect(profondeur.lireProfondeur("bybit", "HYPEUSDT")).toEqual({ debut: date("2025-07-11"), exact: true });
    expect(profondeur.lireProfondeur("mexc", "BTCUSDT")).toEqual({ debut: MAINTENANT - 999 * SEMAINE, exact: false });
  });

  it("cotation récente : le lundi de la 1re bougie 1w est affiné au jour par une sonde 1d", async () => {
    const { profondeur, sonde } = await charger();
    // Binance sert la semaine du lundi 21/09 ; sa vraie première bougie date du jeudi 24/09.
    const binance = sonde("binance", async (_s, tf) => tf === "1w" ? serie(date("2026-09-21"), 1) : serie(date("2026-09-24"), 3, JOUR));
    await profondeur.mesurerProfondeurs([{ exchange: "binance", symbol: "HYPEUSDT" }]);
    expect(binance.mock.calls).toEqual([["HYPEUSDT", "1w", { limit: 1_000 }], ["HYPEUSDT", "1d", { limit: 1_000 }]]);
    expect(profondeur.lireProfondeur("binance", "HYPEUSDT")).toEqual({ debut: date("2026-09-24"), exact: true });
  });

  it("affinage au jour : jamais pour un historique plus ancien que la sonde 1d, ni en échec", async () => {
    const { profondeur, sonde } = await charger();
    const binance = sonde("binance", async () => serie(date("2017-08-14"), 476));
    const bybit = sonde("bybit", async (_s, tf) => { if (tf === "1d") throw new Error("429"); return serie(date("2025-07-07"), 64); });
    await profondeur.mesurerProfondeurs([{ exchange: "binance", symbol: "BTCUSDT" }, { exchange: "bybit", symbol: "HYPEUSDT" }]);
    expect(binance).toHaveBeenCalledTimes(1);
    expect(bybit).toHaveBeenCalledTimes(2);
    // Sonde 1d en échec : le lundi hebdomadaire reste la mesure.
    expect(profondeur.lireProfondeur("bybit", "HYPEUSDT")).toEqual({ debut: date("2025-07-07"), exact: true });
  });

  it("Kraken : 1w par 720 (720 dernières seulement) ; OKX : 1w par 300", async () => {
    const { profondeur, sonde } = await charger();
    const kraken = sonde("kraken", async (symbol) => symbol === "BTCUSD" ? serie(MAINTENANT - 719 * SEMAINE, 720) : serie(date("2026-01-22"), 36));
    const okx = sonde("okx", async (symbol) => symbol === "BTCUSDT" ? serie(MAINTENANT - 299 * SEMAINE, 300) : serie(date("2025-11-04"), 47));
    await profondeur.mesurerProfondeurs([
      { exchange: "kraken", symbol: "BTCUSD" }, { exchange: "kraken", symbol: "HYPEUSD" },
      { exchange: "okx", symbol: "BTCUSDT" }, { exchange: "okx", symbol: "HYPEUSDT" },
    ], 60_000);
    expect(kraken).toHaveBeenCalledWith("HYPEUSD", "1w", { limit: 720 });
    expect(okx).toHaveBeenCalledWith("HYPEUSDT", "1w", { limit: 300 });
    expect(profondeur.lireProfondeur("kraken", "BTCUSD")).toEqual({ debut: MAINTENANT - 719 * SEMAINE, exact: false });
    expect(profondeur.lireProfondeur("kraken", "HYPEUSD")).toEqual({ debut: date("2026-01-22"), exact: true });
    expect(profondeur.lireProfondeur("okx", "BTCUSDT")).toEqual({ debut: MAINTENANT - 299 * SEMAINE, exact: false });
    expect(profondeur.lireProfondeur("okx", "HYPEUSDT")).toEqual({ debut: date("2025-11-04"), exact: true });
  });

  it("Coinbase : 1d par 350, une page courte ne prouve pas le début, la page vide si", async () => {
    const { profondeur, sonde } = await charger();
    const coinbase = sonde("coinbase", async (_symbol, _tf, opts) => opts?.endTime === undefined ? serie(date("2026-02-05"), 233, JOUR) : []);
    await profondeur.mesurerProfondeurs([{ exchange: "coinbase", symbol: "HYPEUSD" }]);
    expect(coinbase.mock.calls).toEqual([["HYPEUSD", "1d", { limit: 350 }], ["HYPEUSD", "1d", { limit: 350, endTime: date("2026-02-05") - 1 }]]);
    expect(profondeur.lireProfondeur("coinbase", "HYPEUSD")).toEqual({ debut: date("2026-02-05"), exact: true });
  });

  it("Coinbase : quatre pages au plus, puis borne (BTCUSD)", async () => {
    const { profondeur, sonde } = await charger();
    const coinbase = sonde("coinbase", async (_symbol, _tf, opts) => serie((opts?.endTime ?? MAINTENANT) - 350 * JOUR, 350, JOUR));
    await profondeur.mesurerProfondeurs([{ exchange: "coinbase", symbol: "BTCUSD" }]);
    expect(coinbase).toHaveBeenCalledTimes(4);
    expect(profondeur.lireProfondeur("coinbase", "BTCUSD")).toEqual({ debut: MAINTENANT - 1_400 * JOUR - 3, exact: false });
  });

  it("Coinbase : une page suivante en échec garde la borne déjà obtenue", async () => {
    const { profondeur, sonde } = await charger();
    sonde("coinbase", async (_symbol, _tf, opts) => {
      if (opts?.endTime !== undefined) throw new Error("429");
      return serie(MAINTENANT - 350 * JOUR, 350, JOUR);
    });
    await profondeur.mesurerProfondeurs([{ exchange: "coinbase", symbol: "BTCUSD" }]);
    expect(profondeur.lireProfondeur("coinbase", "BTCUSD")).toEqual({ debut: MAINTENANT - 350 * JOUR, exact: false });
  });

  it("Coinbase : une page qui ne recule pas arrête la pagination en borne", async () => {
    const { profondeur, sonde } = await charger();
    const coinbase = sonde("coinbase", async () => serie(date("2025-10-11"), 350, JOUR));
    await profondeur.mesurerProfondeurs([{ exchange: "coinbase", symbol: "BTCUSD" }]);
    expect(coinbase).toHaveBeenCalledTimes(2);
    expect(profondeur.lireProfondeur("coinbase", "BTCUSD")).toEqual({ debut: date("2025-10-11"), exact: false });
  });

  it("aucune bougie dès la première page : « vide », en mémoire seule pendant 10 min", async () => {
    const { profondeur, sonde } = await charger();
    const bybit = sonde("bybit", async () => []);
    await profondeur.mesurerProfondeurs([{ exchange: "bybit", symbol: "CARDSUSDT" }]);
    expect(profondeur.lireProfondeur("bybit", "CARDSUSDT")).toBe("vide");
    expect(profondeur.debutAccessible("bybit", "CARDSUSDT", "1h")).toBeNull();
    expect(persiste()?.e["bybit:CARDSUSDT"]).toBeUndefined();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(profondeur.lireProfondeur("bybit", "CARDSUSDT")).toBeUndefined();
    await profondeur.mesurerProfondeurs([{ exchange: "bybit", symbol: "CARDSUSDT" }]);
    expect(bybit).toHaveBeenCalledTimes(2);
  });

  it("échec ou réponse illisible : inconnu, mémorisé 60 s sans marteler la place", async () => {
    const { profondeur, sonde } = await charger();
    const binance = sonde("binance", async () => { throw new Error("HTTP 418"); });
    // Réponse d'une autre forme (ex. catalogue) : temps NaN, jamais stocké.
    const okx = sonde("okx", async () => [bougie(Number.NaN)]);
    const places = [{ exchange: "binance" as const, symbol: "HYPEUSDT" }, { exchange: "okx" as const, symbol: "HYPEUSDT" }];
    await profondeur.mesurerProfondeurs(places);
    expect(profondeur.lireProfondeur("binance", "HYPEUSDT")).toBeUndefined();
    expect(profondeur.lireProfondeur("okx", "HYPEUSDT")).toBeUndefined();
    await vi.advanceTimersByTimeAsync(59_999);
    await profondeur.mesurerProfondeurs(places);
    expect([binance.mock.calls.length, okx.mock.calls.length]).toEqual([1, 1]);
    await vi.advanceTimersByTimeAsync(1);
    await profondeur.mesurerProfondeurs(places);
    expect([binance.mock.calls.length, okx.mock.calls.length]).toEqual([2, 2]);
    expect(stockage.has(CLE)).toBe(false);
  });

  it("places non mesurables (Twelve Data, Hyperliquid, synthétique) : aucune sonde, résolution immédiate", async () => {
    const { profondeur, sonde } = await charger();
    const espions = (["twelvedata", "hyperliquid", "synthetic"] as const).map((place) => sonde(place, async () => serie(date("2020-01-01"), 10)));
    let fini = false;
    void profondeur.mesurerProfondeurs([
      { exchange: "twelvedata", symbol: "GLD" }, { exchange: "hyperliquid", symbol: "BTC-PERP" }, { exchange: "synthetic", symbol: "TOTAL" },
    ]).then(() => { fini = true; });
    await Promise.resolve();
    expect(fini).toBe(true);
    for (const espion of espions) expect(espion).not.toHaveBeenCalled();
  });
});

describe("débit : délai, file par place et dédoublonnage", () => {
  it("résout au plus tard après le délai ; la mesure finit en fond et remplit le cache", async () => {
    const { profondeur, sonde } = await charger();
    const reponse = differee<Candle[]>();
    sonde("bybit", () => reponse.promesse);
    const notifications = vi.fn();
    profondeur.abonnerProfondeurs(notifications);
    let fini = false;
    void profondeur.mesurerProfondeurs([{ exchange: "bybit", symbol: "HYPEUSDT" }]).then(() => { fini = true; });
    await vi.advanceTimersByTimeAsync(2_499);
    expect(fini).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(fini).toBe(true);
    expect(profondeur.lireProfondeur("bybit", "HYPEUSDT")).toBeUndefined();
    reponse.resoudre(serie(date("2025-07-11"), 64));
    await vi.advanceTimersByTimeAsync(0);
    expect(profondeur.lireProfondeur("bybit", "HYPEUSDT")).toEqual({ debut: date("2025-07-11"), exact: true });
    expect(notifications).toHaveBeenCalledTimes(1);
  });

  it("résout dès que les mesures sont finies, sans attendre le délai ; ne rejette jamais", async () => {
    const { profondeur, sonde } = await charger();
    sonde("bybit", async () => { throw new Error("hors ligne"); });
    sonde("okx", async () => serie(date("2025-11-04"), 47));
    let fini = false;
    void profondeur.mesurerProfondeurs([{ exchange: "bybit", symbol: "HYPEUSDT" }, { exchange: "okx", symbol: "HYPEUSDT" }]).then(() => { fini = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(fini).toBe(true);
  });

  it("mesures en vol dédoublonnées : même place et même symbole, une seule sonde", async () => {
    const { profondeur, sonde } = await charger();
    const reponse = differee<Candle[]>();
    const bybit = sonde("bybit", () => reponse.promesse);
    const a = profondeur.mesurerProfondeurs([{ exchange: "bybit", symbol: "HYPEUSDT" }]);
    const b = profondeur.mesurerProfondeurs([{ exchange: "bybit", symbol: "HYPEUSDT" }, { exchange: "bybit", symbol: "HYPEUSDT" }]);
    reponse.resoudre(serie(date("2025-07-11"), 64));
    await Promise.all([a, b]);
    // Une sonde 1w (la cotation récente ajoute seulement son affinage 1d).
    expect(bybit.mock.calls.filter(([, tf]) => tf === "1w")).toHaveLength(1);
  });

  it("deux sondes à la fois par place, une seule chez Kraken et Coinbase", async () => {
    const { profondeur, sonde } = await charger();
    const enAttente: Array<(bougies: Candle[]) => void> = [];
    const attendre = () => new Promise<Candle[]>((ok) => { enAttente.push(ok); });
    const bybit = sonde("bybit", attendre);
    const kraken = sonde("kraken", attendre);
    void profondeur.mesurerProfondeurs(["HYPEUSDT", "BTCUSDT", "ETHUSDT"].map((symbol) => ({ exchange: "bybit" as const, symbol })));
    void profondeur.mesurerProfondeurs(["HYPEUSD", "BTCUSD"].map((symbol) => ({ exchange: "kraken" as const, symbol })));
    await vi.advanceTimersByTimeAsync(0);
    expect([bybit.mock.calls.length, kraken.mock.calls.length]).toEqual([2, 1]);
    enAttente.shift()!(serie(date("2025-07-11"), 64));
    await vi.advanceTimersByTimeAsync(0);
    expect([bybit.mock.calls.length, kraken.mock.calls.length]).toEqual([3, 1]);
  });

  it("une sonde muette libère sa place au bout de 15 s (inconnu) ; la suivante part", async () => {
    const { profondeur, sonde } = await charger();
    const kraken = sonde("kraken", (symbol) => symbol === "HYPEUSD" ? new Promise<Candle[]>(() => {}) : Promise.resolve(serie(date("2013-09-30"), 720)));
    void profondeur.mesurerProfondeurs([{ exchange: "kraken", symbol: "HYPEUSD" }, { exchange: "kraken", symbol: "BTCUSD" }]);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(kraken).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(kraken).toHaveBeenCalledTimes(2);
    expect(profondeur.lireProfondeur("kraken", "HYPEUSD")).toBeUndefined();
    expect(profondeur.lireProfondeur("kraken", "BTCUSD")).toEqual({ debut: date("2013-09-30"), exact: false });
  });
});

describe("cache persistant", () => {
  it("écrit un JSON compact et le relit sans nouvelle sonde après rechargement", async () => {
    const premier = await charger();
    premier.sonde("bybit", async () => serie(date("2025-07-11"), 64));
    await premier.profondeur.mesurerProfondeurs([{ exchange: "bybit", symbol: "HYPEUSDT" }]);
    expect(persiste()).toEqual({ v: 1, e: { "bybit:HYPEUSDT": [date("2025-07-11"), 1, MAINTENANT] } });
    vi.resetModules();
    const second = await charger();
    const bybit = second.sonde("bybit", async () => []);
    expect(second.profondeur.lireProfondeur("bybit", "HYPEUSDT")).toEqual({ debut: date("2025-07-11"), exact: true });
    await second.profondeur.mesurerProfondeurs([{ exchange: "bybit", symbol: "HYPEUSDT" }]);
    expect(bybit).not.toHaveBeenCalled();
  });

  it("TTL de 30 jours : une mesure plus ancienne est ignorée et remesurée", async () => {
    stockage.set(CLE, JSON.stringify({ v: 1, e: {
      "bybit:HYPEUSDT": [date("2025-07-11"), 1, MAINTENANT - 30 * JOUR],
      "okx:HYPEUSDT": [date("2025-11-04"), 1, MAINTENANT - 30 * JOUR + 1],
    } }));
    const { profondeur, sonde } = await charger();
    expect(profondeur.lireProfondeur("bybit", "HYPEUSDT")).toBeUndefined();
    expect(profondeur.lireProfondeur("okx", "HYPEUSDT")).toEqual({ debut: date("2025-11-04"), exact: true });
    await vi.advanceTimersByTimeAsync(1);
    expect(profondeur.lireProfondeur("okx", "HYPEUSDT")).toBeUndefined();
    const bybit = sonde("bybit", async () => serie(date("2025-07-11"), 64));
    await profondeur.mesurerProfondeurs([{ exchange: "bybit", symbol: "HYPEUSDT" }]);
    expect(bybit.mock.calls.filter(([, tf]) => tf === "1w")).toHaveLength(1);
  });

  it("au plus 1 000 entrées : les mesures les plus anciennes sont élaguées", async () => {
    const e: Record<string, [number, number, number]> = {};
    for (let i = 0; i < 1_000; i++) e[`binance:X${i}USDT`] = [date("2024-01-01"), 1, MAINTENANT - JOUR + i];
    stockage.set(CLE, JSON.stringify({ v: 1, e }));
    const { profondeur, sonde } = await charger();
    sonde("bybit", async () => serie(date("2025-07-11"), 64));
    await profondeur.mesurerProfondeurs([{ exchange: "bybit", symbol: "HYPEUSDT" }]);
    const entrees = persiste()!.e;
    expect(Object.keys(entrees)).toHaveLength(1_000);
    expect(entrees["bybit:HYPEUSDT"]).toBeDefined();
    expect(entrees["binance:X0USDT"]).toBeUndefined();
    expect(entrees["binance:X1USDT"]).toBeDefined();
  });

  it("localStorage qui lève ou contenu corrompu : mémoire seule, jamais d'exception", async () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceededError"); } });
    const { profondeur, sonde } = await charger();
    sonde("bybit", async () => serie(date("2025-07-11"), 64));
    await profondeur.mesurerProfondeurs([{ exchange: "bybit", symbol: "HYPEUSDT" }]);
    expect(profondeur.lireProfondeur("bybit", "HYPEUSDT")).toEqual({ debut: date("2025-07-11"), exact: true });
    vi.resetModules();
    vi.stubGlobal("localStorage", { getItem: () => "{\"v\":1,\"e\":{\"bybit:HYPEUSDT\":\"x\",\"okx:HYPEUSDT\":[1]}", setItem: () => {} });
    const corrompu = await charger();
    expect(corrompu.profondeur.lireProfondeur("bybit", "HYPEUSDT")).toBeUndefined();
    vi.resetModules();
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ v: 1, e: { "bybit:HYPEUSDT": "x", "okx:HYPEUSDT": [1], "kraken:HYPEUSD": [date("2026-01-22"), 1, MAINTENANT] } }), setItem: () => {} });
    const partiel = await charger();
    expect(partiel.profondeur.lireProfondeur("bybit", "HYPEUSDT")).toBeUndefined();
    expect(partiel.profondeur.lireProfondeur("okx", "HYPEUSDT")).toBeUndefined();
    expect(partiel.profondeur.lireProfondeur("kraken", "HYPEUSD")).toEqual({ debut: date("2026-01-22"), exact: true });
  });

  it("abonnement : notifié à chaque mesure entrée au cache, désabonnable", async () => {
    const { profondeur, sonde } = await charger();
    sonde("bybit", async () => serie(date("2025-07-11"), 64));
    sonde("okx", async () => serie(date("2025-11-04"), 47));
    const ecoute = vi.fn();
    const desabonner = profondeur.abonnerProfondeurs(ecoute);
    await profondeur.mesurerProfondeurs([{ exchange: "bybit", symbol: "HYPEUSDT" }]);
    expect(ecoute).toHaveBeenCalledTimes(1);
    desabonner();
    await profondeur.mesurerProfondeurs([{ exchange: "okx", symbol: "HYPEUSDT" }]);
    expect(ecoute).toHaveBeenCalledTimes(1);
  });
});

describe("historique accessible au graphe", () => {
  const precharger = (e: Record<string, [number, number, number]>) => stockage.set(CLE, JSON.stringify({ v: 1, e }));

  it("plafond du graphe (20 000 bougies) et plafonds propres à OKX, Kraken, Hyperliquid", async () => {
    precharger({
      "binance:BTCUSDT": [date("2017-08-17"), 1, MAINTENANT],
      "okx:BTCUSDT": [MAINTENANT - 300 * SEMAINE, 0, MAINTENANT],
      "kraken:BTCUSD": [MAINTENANT - 720 * SEMAINE, 0, MAINTENANT],
      "hyperliquid:BTC-PERP": [date("2023-01-01"), 1, MAINTENANT],
    });
    const { profondeur } = await charger();
    expect(profondeur.PLAFOND_BOUGIES_GRAPHE).toBe(20_000);
    expect(profondeur.debutAccessible("binance", "BTCUSDT", "1d")).toBe(date("2017-08-17"));
    expect(profondeur.debutAccessible("binance", "BTCUSDT", "1h")).toBe(MAINTENANT - 20_000 * 3_600_000);
    expect(profondeur.debutAccessible("binance", "BTCUSDT", "1m")).toBe(MAINTENANT - 20_000 * 60_000);
    expect(profondeur.debutAccessible("okx", "BTCUSDT", "1d")).toBe(MAINTENANT - 1_440 * JOUR);
    expect(profondeur.debutAccessible("okx", "BTCUSDT", "1w")).toBe(MAINTENANT - 300 * SEMAINE);
    expect(profondeur.debutAccessible("kraken", "BTCUSD", "1d")).toBe(MAINTENANT - 720 * JOUR);
    expect(profondeur.debutAccessible("kraken", "BTCUSD", "1h")).toBe(MAINTENANT - 720 * 3_600_000);
    expect(profondeur.debutAccessible("hyperliquid", "BTC-PERP", "1h")).toBe(MAINTENANT - 5_000 * 3_600_000);
    // Mois de 30 jours, trimestre/semestre/année proportionnels ; `maintenant` explicite.
    expect(profondeur.debutAccessible("kraken", "BTCUSD", "1M", MAINTENANT + JOUR)).toBe(MAINTENANT - 720 * SEMAINE);
    expect(profondeur.debutAccessible("okx", "BTCUSDT", "12M")).toBe(MAINTENANT - 300 * SEMAINE);
    expect(profondeur.debutAccessible("coinbase", "BTCUSD", "1d")).toBeUndefined();
  });

  it("tolérance : 5 % de la fenêtre du graphe, bornée à 7 jours, jamais sous une bougie", async () => {
    const { profondeur } = await charger();
    // 1m : la fenêtre de 20 000 bougies ne couvre que ~13,9 j ; 7 jours y rendraient équivalente
    // une place qui n'a que la moitié de l'historique (HYPEUSDT, Binance coté le 24/09).
    expect(profondeur.toleranceProfondeurMs("1m")).toBe(1_000 * 60_000);
    expect(profondeur.toleranceProfondeurMs("5m")).toBe(5_000 * 60_000);
    expect(profondeur.toleranceProfondeurMs("15m")).toBe(SEMAINE);
    expect(profondeur.toleranceProfondeurMs("1h")).toBe(SEMAINE);
    expect(profondeur.toleranceProfondeurMs("1d")).toBe(SEMAINE);
    expect(profondeur.toleranceProfondeurMs("1w")).toBe(SEMAINE);
    expect(profondeur.toleranceProfondeurMs("3d")).toBe(SEMAINE);
    expect(profondeur.toleranceProfondeurMs("1M")).toBe(30 * JOUR);
    expect(profondeur.toleranceProfondeurMs("3M")).toBe(90 * JOUR);
    expect(profondeur.toleranceProfondeurMs("12M")).toBe(360 * JOUR);
  });
});
