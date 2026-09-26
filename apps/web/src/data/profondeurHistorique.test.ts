/**
 * Profondeur d'historique par place : sondes via les adaptateurs (espionnés, aucun réseau),
 * cache mémoire + localStorage bouchonné, file par place (priorité, espacement, abandon).
 * Horloge figée au 26/09/2026.
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

  it("Kraken : 1w par 720 (720 dernières seulement) ; OKX : 1M par 300 (25 ans, exact), affiné au lundi par une page 1w", async () => {
    const { profondeur, sonde } = await charger();
    const kraken = sonde("kraken", async (symbol) => symbol === "BTCUSD" ? serie(MAINTENANT - 719 * SEMAINE, 720) : serie(date("2026-01-22"), 36));
    // OKX réel : BTC-USDT en 1Mutc depuis le 01/01/2018 (105 mois), 1re semaine le 08/01/2018 ;
    // HYPE-USDT depuis le 01/11/2025, 1re semaine le 03/11/2025 (hors de portée d'une sonde 1d).
    const okx = sonde("okx", async (symbol, tf) => {
      const [mois, semaine, n] = symbol === "BTCUSDT" ? [date("2018-01-01"), date("2018-01-08"), 105] : [date("2025-11-01"), date("2025-11-03"), 11];
      return tf === "1M" ? serie(mois, n, 30 * JOUR) : serie(semaine, 5);
    });
    const fin = profondeur.mesurerProfondeurs([
      { exchange: "kraken", symbol: "BTCUSD" }, { exchange: "kraken", symbol: "HYPEUSD" },
      { exchange: "okx", symbol: "BTCUSDT" }, { exchange: "okx", symbol: "HYPEUSDT" },
    ], 60_000);
    // Kraken : départs espacés d'une seconde.
    await vi.advanceTimersByTimeAsync(1_000);
    await fin;
    expect(kraken).toHaveBeenCalledWith("HYPEUSD", "1w", { limit: 720 });
    expect(okx.mock.calls).toEqual([
      ["BTCUSDT", "1M", { limit: 300 }], ["BTCUSDT", "1w", { limit: 6, endTime: date("2018-01-01") + 5 * SEMAINE }],
      ["HYPEUSDT", "1M", { limit: 300 }], ["HYPEUSDT", "1w", { limit: 6, endTime: date("2025-11-01") + 5 * SEMAINE }],
    ]);
    expect(profondeur.lireProfondeur("kraken", "BTCUSD")).toEqual({ debut: MAINTENANT - 719 * SEMAINE, exact: false });
    expect(profondeur.lireProfondeur("kraken", "HYPEUSD")).toEqual({ debut: date("2026-01-22"), exact: true });
    expect(profondeur.lireProfondeur("okx", "BTCUSDT")).toEqual({ debut: date("2018-01-08"), exact: true });
    expect(profondeur.lireProfondeur("okx", "HYPEUSDT")).toEqual({ debut: date("2025-11-03"), exact: true });
  });

  it("OKX coté depuis moins de 292 jours : le 1er du mois est affiné au jour par une sonde 1d, sans page 1w", async () => {
    const { profondeur, sonde } = await charger();
    const okx = sonde("okx", async (_s, tf) => tf === "1M" ? serie(date("2026-03-01"), 7, 30 * JOUR) : serie(date("2026-03-12"), 199, JOUR));
    await profondeur.mesurerProfondeurs([{ exchange: "okx", symbol: "CARDSUSDT" }]);
    expect(okx.mock.calls).toEqual([["CARDSUSDT", "1M", { limit: 300 }], ["CARDSUSDT", "1d", { limit: 300 }]]);
    expect(profondeur.lireProfondeur("okx", "CARDSUSDT")).toEqual({ debut: date("2026-03-12"), exact: true });
  });

  it("OKX : page 1w en échec ou incohérente, le 1er du mois reste la mesure (exacte)", async () => {
    const { profondeur, sonde } = await charger();
    sonde("okx", async (symbol, tf) => {
      if (tf === "1M") return serie(date("2019-02-01"), 92, 30 * JOUR);
      if (symbol === "LTCUSDT") throw new Error("429");
      return serie(date("2018-06-04"), 6); // antérieure au mois : ignorée
    });
    const fin = profondeur.mesurerProfondeurs([{ exchange: "okx", symbol: "LTCUSDT" }, { exchange: "okx", symbol: "XRPUSDT" }]);
    await vi.advanceTimersByTimeAsync(70); // seconde sonde OKX : 70 ms après la première
    await fin;
    expect(profondeur.lireProfondeur("okx", "LTCUSDT")).toEqual({ debut: date("2019-02-01"), exact: true });
    expect(profondeur.lireProfondeur("okx", "XRPUSDT")).toEqual({ debut: date("2019-02-01"), exact: true });
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

  it("aucune bougie dès la première page : « vide », en mémoire seule pendant 24 h", async () => {
    const { profondeur, sonde } = await charger();
    const bybit = sonde("bybit", async () => []);
    await profondeur.mesurerProfondeurs([{ exchange: "bybit", symbol: "CARDSUSDT" }]);
    expect(profondeur.lireProfondeur("bybit", "CARDSUSDT")).toBe("vide");
    expect(profondeur.debutAccessible("bybit", "CARDSUSDT", "1h")).toBeNull();
    expect(persiste()?.e["bybit:CARDSUSDT"]).toBeUndefined();
    await vi.advanceTimersByTimeAsync(JOUR - 1);
    expect(profondeur.lireProfondeur("bybit", "CARDSUSDT")).toBe("vide");
    await vi.advanceTimersByTimeAsync(1);
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

  it("deux sondes à la fois par place, Kraken et Coinbase compris (départs espacés)", async () => {
    const { profondeur, sonde } = await charger();
    const enAttente: Array<(bougies: Candle[]) => void> = [];
    const attendre = () => new Promise<Candle[]>((ok) => { enAttente.push(ok); });
    const bybit = sonde("bybit", attendre);
    const kraken = sonde("kraken", attendre);
    void profondeur.mesurerProfondeurs(["HYPEUSDT", "BTCUSDT", "ETHUSDT"].map((symbol) => ({ exchange: "bybit" as const, symbol })));
    void profondeur.mesurerProfondeurs(["HYPEUSD", "BTCUSD", "ETHUSD"].map((symbol) => ({ exchange: "kraken" as const, symbol })));
    await vi.advanceTimersByTimeAsync(999);
    expect([bybit.mock.calls.length, kraken.mock.calls.length]).toEqual([2, 1]);
    await vi.advanceTimersByTimeAsync(1);
    expect([bybit.mock.calls.length, kraken.mock.calls.length]).toEqual([2, 2]);
    // Fin réelle de la première sonde Bybit (historique ancien, sans affinage) : la troisième part.
    enAttente.shift()!(serie(date("2021-07-05"), 273));
    await vi.advanceTimersByTimeAsync(5_000);
    expect([bybit.mock.calls.length, kraken.mock.calls.length]).toEqual([3, 2]);
  });

  it("départs espacés sur une même place : Kraken 1 s, Coinbase 200 ms, OKX 70 ms, les autres 50 ms", async () => {
    const { profondeur, sonde } = await charger();
    const departs: Partial<Record<ExchangeId, number[]>> = {};
    for (const place of ["kraken", "coinbase", "okx", "bybit"] as const) {
      sonde(place, async (_s, _tf, opts) => {
        if (opts?.endTime === undefined) (departs[place] ??= []).push(Date.now() - MAINTENANT);
        return serie(date("2020-01-06"), 300);
      });
    }
    const fin = profondeur.mesurerProfondeurs((["kraken", "coinbase", "okx", "bybit"] as const)
      .flatMap((exchange) => ["BTCUSD", "ETHUSD", "SOLUSD"].map((symbol) => ({ exchange, symbol }))), 60_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await fin;
    expect(departs).toEqual({ kraken: [0, 1_000, 2_000], coinbase: [0, 200, 400], okx: [0, 70, 140], bybit: [0, 50, 100] });
  });

  it("une sonde muette rend « inconnu » à 15 s mais garde son créneau jusqu'à la fin réelle ; la réponse tardive entre au cache", async () => {
    const { profondeur, sonde } = await charger();
    const reponse = differee<Candle[]>();
    const kraken = sonde("kraken", (symbol) => symbol === "HYPEUSD" ? reponse.promesse : Promise.resolve(serie(date("2013-09-30"), 720)));
    let fini = false;
    // Favoris : un seul créneau Kraken (le second reste au graphe).
    void profondeur.mesurerProfondeurs([{ exchange: "kraken", symbol: "HYPEUSD" }, { exchange: "kraken", symbol: "BTCUSD" }], 60_000, { priorite: "favoris" }).then(() => { fini = true; });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(profondeur.lireProfondeur("kraken", "HYPEUSD")).toBeUndefined();
    // La requête court toujours : BTCUSD reste en file derrière elle, le créneau n'est pas rendu à 15 s.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(kraken).toHaveBeenCalledTimes(1);
    expect(fini).toBe(false);
    reponse.resoudre(serie(date("2026-01-22"), 36));
    await vi.advanceTimersByTimeAsync(0);
    // Affinage 1d de HYPEUSD dans le même créneau, puis BTCUSD.
    expect(kraken.mock.calls.map(([symbol, tf]) => `${symbol}@${tf}`)).toEqual(["HYPEUSD@1w", "HYPEUSD@1d", "BTCUSD@1w"]);
    expect(profondeur.lireProfondeur("kraken", "HYPEUSD")).toEqual({ debut: date("2026-01-22"), exact: true });
    expect(profondeur.lireProfondeur("kraken", "BTCUSD")).toEqual({ debut: date("2013-09-30"), exact: false });
    expect(fini).toBe(true);
  });
});

describe("priorité et abandon : graphe, puis favoris, puis recherche", () => {
  /** Kraken (recherche et favoris une à la fois) : chaque sonde attend `terminer()` ; ordre de départ relevé. */
  async function file() {
    const { profondeur, sonde } = await charger();
    const enCours: Array<() => void> = [];
    const kraken = sonde("kraken", () => new Promise<Candle[]>((ok) => { enCours.push(() => ok(serie(date("2019-12-16"), 350))); }));
    const departs = () => kraken.mock.calls.map(([symbol]) => symbol);
    /** Termine la sonde en cours puis laisse passer l'espacement Kraken (1 s). */
    const terminer = async () => { enCours.shift()!(); await vi.advanceTimersByTimeAsync(1_000); };
    const places = (...symboles: string[]) => symboles.map((symbol) => ({ exchange: "kraken" as const, symbol }));
    return { profondeur, departs, terminer, places };
  }

  it("la file sert le graphe, puis les favoris, puis la recherche ; à priorité égale, l'ordre d'arrivée", async () => {
    const { profondeur, departs, terminer, places } = await file();
    void profondeur.mesurerProfondeurs(places("XRPUSD", "ADAUSD"), 60_000, { priorite: "recherche" });
    void profondeur.mesurerProfondeurs(places("ETHUSD"), 60_000, { priorite: "favoris" });
    void profondeur.mesurerProfondeurs(places("SOLUSD"), 60_000);
    void profondeur.mesurerProfondeurs(places("DOTUSD"), 60_000, { priorite: "recherche" });
    for (let i = 0; i < 4; i++) await terminer();
    expect(departs()).toEqual(["XRPUSD", "SOLUSD", "ETHUSD", "ADAUSD", "DOTUSD"]);
  });

  it("places à deux créneaux : recherche et favoris n'en occupent qu'un, le second reste au graphe", async () => {
    const { profondeur, sonde } = await charger();
    const fins = new Map<string, () => void>();
    const bybit = sonde("bybit", (symbol) => new Promise<Candle[]>((ok) => { fins.set(symbol, () => ok(serie(date("2021-07-05"), 273))); }));
    const departs = () => bybit.mock.calls.map(([symbol]) => symbol);
    const places = (...symboles: string[]) => symboles.map((symbol) => ({ exchange: "bybit" as const, symbol }));
    void profondeur.mesurerProfondeurs(places("HYPERUSDT", "HBARUSDT", "HOOKUSDT"), 60_000, { priorite: "recherche" });
    void profondeur.mesurerProfondeurs(places("ETHUSDT"), 60_000, { priorite: "favoris" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(departs()).toEqual(["HYPERUSDT"]);
    // Le graphe prend aussitôt le créneau réservé, même derrière une sonde de recherche encore en cours.
    void profondeur.mesurerProfondeurs(places("HYPEUSDT"), 60_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(departs()).toEqual(["HYPERUSDT", "HYPEUSDT"]);
    // Le graphe servi, son créneau reste réservé : les favoris attendent la fin de la recherche en cours.
    fins.get("HYPEUSDT")!();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(departs()).toEqual(["HYPERUSDT", "HYPEUSDT"]);
    fins.get("HYPERUSDT")!();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(departs()).toEqual(["HYPERUSDT", "HYPEUSDT", "ETHUSDT"]);
  });

  it("Coinbase : la recherche n'occupe qu'un créneau ; le graphe prend le second sans attendre la fin de sa pagination", async () => {
    const { profondeur, sonde } = await charger();
    const requetes: string[] = [];
    sonde("coinbase", (symbol, _tf, opts) => {
      requetes.push(`${Date.now() - MAINTENANT}:${symbol}${opts?.endTime === undefined ? "" : "+"}`);
      // HBARUSD coté en 2019 : quatre pages pleines ; HYPEUSD (05/02/2026) : 233 bougies, puis page vide.
      const bougies = symbol !== "HYPEUSD" ? serie((opts?.endTime ?? MAINTENANT) - 350 * JOUR, 350, JOUR)
        : opts?.endTime === undefined ? serie(date("2026-02-05"), 233, JOUR) : [];
      return new Promise<Candle[]>((ok) => setTimeout(() => ok(bougies), 700));
    });
    void profondeur.mesurerProfondeurs([{ exchange: "coinbase", symbol: "HBARUSD" }, { exchange: "coinbase", symbol: "HNTUSD" }], 60_000, { priorite: "recherche" });
    await vi.advanceTimersByTimeAsync(100);
    let fini = false;
    void profondeur.mesurerProfondeurs([{ exchange: "coinbase", symbol: "HYPEUSD" }]).then(() => { fini = true; });
    // Le graphe part à l'espacement Coinbase (200 ms), avant la page 2 de la recherche (700 ms).
    await vi.advanceTimersByTimeAsync(100);
    expect(requetes).toEqual(["0:HBARUSD", "200:HYPEUSD"]);
    await vi.advanceTimersByTimeAsync(1_399);
    expect(fini).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(fini).toBe(true);
    expect(profondeur.lireProfondeur("coinbase", "HYPEUSD")).toEqual({ debut: date("2026-02-05"), exact: true });
    // Le créneau du graphe libéré, HNTUSD (recherche) attend quand même la fin réelle de HBARUSD.
    await vi.advanceTimersByTimeAsync(1_200);
    expect(requetes).toEqual(["0:HBARUSD", "200:HYPEUSD", "700:HBARUSD+", "900:HYPEUSD+", "1400:HBARUSD+", "2100:HBARUSD+", "2800:HNTUSD"]);
  });

  it("Kraken : la sonde du graphe part à l'espacement (1 s) pendant qu'une sonde de recherche court encore", async () => {
    const { profondeur, sonde } = await charger();
    const recherche = differee<Candle[]>();
    const kraken = sonde("kraken", (symbol) => symbol === "HBARUSD" ? recherche.promesse : Promise.resolve(serie(date("2019-12-16"), 350)));
    const departs = () => kraken.mock.calls.map(([symbol]) => symbol);
    void profondeur.mesurerProfondeurs([{ exchange: "kraken", symbol: "HBARUSD" }, { exchange: "kraken", symbol: "HNTUSD" }], 60_000, { priorite: "recherche" });
    await vi.advanceTimersByTimeAsync(300);
    let fini = false;
    void profondeur.mesurerProfondeurs([{ exchange: "kraken", symbol: "PEPEUSD" }]).then(() => { fini = true; });
    await vi.advanceTimersByTimeAsync(699);
    expect(departs()).toEqual(["HBARUSD"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(departs()).toEqual(["HBARUSD", "PEPEUSD"]);
    expect(fini).toBe(true);
    // Jamais deux sondes de recherche à la fois : HNTUSD attend la fin réelle de HBARUSD.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(departs()).toEqual(["HBARUSD", "PEPEUSD"]);
    recherche.resoudre(serie(date("2019-12-16"), 350));
    await vi.advanceTimersByTimeAsync(0);
    expect(departs()).toEqual(["HBARUSD", "PEPEUSD", "HNTUSD"]);
  });

  it("une sonde de recherche en file rejointe par le graphe est promue ; elle retombe si ce graphe abandonne", async () => {
    const { profondeur, departs, terminer, places } = await file();
    void profondeur.mesurerProfondeurs(places("XRPUSD", "ADAUSD", "DOTUSD", "LINKUSD"), 60_000, { priorite: "recherche" });
    void profondeur.mesurerProfondeurs(places("DOTUSD"), 60_000);
    const abandon = new AbortController();
    let fini = false;
    void profondeur.mesurerProfondeurs(places("LINKUSD"), 60_000, { signal: abandon.signal }).then(() => { fini = true; });
    abandon.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(fini).toBe(true);
    for (let i = 0; i < 3; i++) await terminer();
    // LINKUSD, toujours attendu par la recherche, n'est pas retiré : il revient à son rang.
    expect(departs()).toEqual(["XRPUSD", "DOTUSD", "ADAUSD", "LINKUSD"]);
  });

  it("abandon : les sondes non démarrées que personne d'autre n'attend sont retirées, l'appel résout aussitôt", async () => {
    const { profondeur, departs, terminer, places } = await file();
    const recherche = new AbortController();
    let fini = false;
    void profondeur.mesurerProfondeurs(places("XRPUSD", "ADAUSD", "DOTUSD"), 60_000, { priorite: "recherche", signal: recherche.signal }).then(() => { fini = true; });
    void profondeur.mesurerProfondeurs(places("DOTUSD"), 60_000, { priorite: "favoris" });
    recherche.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(fini).toBe(true);
    await terminer();
    await terminer();
    // XRPUSD déjà partie finit et entre au cache ; DOTUSD reste attendue par les favoris.
    expect(departs()).toEqual(["XRPUSD", "DOTUSD"]);
    expect(profondeur.lireProfondeur("kraken", "XRPUSD")).toEqual({ debut: date("2019-12-16"), exact: true });
    expect(profondeur.lireProfondeur("kraken", "ADAUSD")).toBeUndefined();
    // Retirée n'est pas « en échec » : une nouvelle demande la mesure aussitôt.
    void profondeur.mesurerProfondeurs(places("ADAUSD"), 60_000, { priorite: "recherche" });
    await vi.advanceTimersByTimeAsync(0);
    expect(departs()).toEqual(["XRPUSD", "DOTUSD", "ADAUSD"]);
  });

  it("abandon après la résolution par le délai : les sondes encore en file sont purgées quand même", async () => {
    const { profondeur, departs, terminer, places } = await file();
    const recherche = new AbortController();
    let fini = false;
    void profondeur.mesurerProfondeurs(places("XRPUSD", "ADAUSD", "DOTUSD"), 2_500, { priorite: "recherche", signal: recherche.signal }).then(() => { fini = true; });
    await vi.advanceTimersByTimeAsync(2_500);
    expect(fini).toBe(true);
    recherche.abort();
    await terminer();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(departs()).toEqual(["XRPUSD"]);
  });

  it("assez : résout dès qu'il vaut vrai à une mesure entrée au cache ; vrai d'emblée, aucune sonde ; s'il lève, ignoré", async () => {
    const { profondeur, sonde } = await charger();
    sonde("binance", async () => serie(date("2017-08-14"), 476));
    const bybit = sonde("bybit", () => new Promise<Candle[]>(() => {}));
    const assez = vi.fn(() => profondeur.lireProfondeur("binance", "BTCUSDT") !== undefined);
    let fini = false;
    void profondeur.mesurerProfondeurs([{ exchange: "binance", symbol: "BTCUSDT" }, { exchange: "bybit", symbol: "BTCUSDT" }], 2_500, { assez }).then(() => { fini = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(fini).toBe(true);
    expect(bybit).toHaveBeenCalledTimes(1); // partie, elle finit en fond
    const okx = sonde("okx", async () => serie(date("2018-01-01"), 105, 30 * JOUR));
    await profondeur.mesurerProfondeurs([{ exchange: "okx", symbol: "BTCUSDT" }], 2_500, { assez: () => true });
    expect(okx).not.toHaveBeenCalled();
    let fin: unknown = "en attente";
    void profondeur.mesurerProfondeurs([{ exchange: "okx", symbol: "BTCUSDT" }], 2_500, { assez: () => { throw new Error("vue démontée"); } })
      .then((valeur) => { fin = valeur; }, (erreur: unknown) => { fin = erreur; });
    await vi.advanceTimersByTimeAsync(0);
    expect(fin).toBeUndefined();
    expect(okx).toHaveBeenCalled();
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

  it("TTL étalé de 25 à 35 jours, fixe par clé : des mesures du même jour n'expirent pas ensemble", async () => {
    const symboles = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT", "AVAXUSDT", "DOTUSDT", "LTCUSDT",
      "BCHUSDT", "UNIUSDT", "AAVEUSDT", "NEARUSDT", "APTUSDT", "ARBUSDT", "OPUSDT", "SUIUSDT", "TONUSDT", "HYPEUSDT"];
    /** Module neuf, mesures Bybit toutes prises il y a `age` ms : clés encore valides. */
    const valides = async (age: number) => {
      vi.resetModules();
      stockage.set(CLE, JSON.stringify({ v: 1, e: Object.fromEntries(symboles.map((s) => [`bybit:${s}`, [date("2021-07-05"), 1, MAINTENANT - age]])) }));
      const { profondeur } = await charger();
      return symboles.filter((s) => profondeur.lireProfondeur("bybit", s) !== undefined);
    };
    expect(await valides(25 * JOUR - 1)).toEqual(symboles);
    expect(await valides(35 * JOUR)).toEqual([]);
    const a30 = await valides(30 * JOUR);
    expect(a30.length).toBeGreaterThan(0);
    expect(a30.length).toBeLessThan(symboles.length);
    // Pseudo-aléa déterministe : même verdict au rechargement suivant.
    expect(await valides(30 * JOUR)).toEqual(a30);
  });

  it("une mesure expirée est remesurée ; la nouvelle entrée repart pour 25 à 35 jours", async () => {
    stockage.set(CLE, JSON.stringify({ v: 1, e: { "bybit:HYPEUSDT": [date("2025-07-11"), 1, MAINTENANT - 35 * JOUR] } }));
    const { profondeur, sonde } = await charger();
    expect(profondeur.lireProfondeur("bybit", "HYPEUSDT")).toBeUndefined();
    const bybit = sonde("bybit", async () => serie(date("2025-07-11"), 64));
    await profondeur.mesurerProfondeurs([{ exchange: "bybit", symbol: "HYPEUSDT" }]);
    expect(bybit.mock.calls.filter(([, tf]) => tf === "1w")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(25 * JOUR - 1);
    expect(profondeur.lireProfondeur("bybit", "HYPEUSDT")).toEqual({ debut: date("2025-07-11"), exact: true });
    await vi.advanceTimersByTimeAsync(10 * JOUR + 1);
    expect(profondeur.lireProfondeur("bybit", "HYPEUSDT")).toBeUndefined();
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

  it("plafond du graphe (20 000 bougies) et plafonds propres à OKX (1 440), Kraken (500 : backfill sans pagination)", async () => {
    precharger({
      "binance:BTCUSDT": [date("2017-08-17"), 1, MAINTENANT],
      "okx:BTCUSDT": [MAINTENANT - 300 * SEMAINE, 0, MAINTENANT],
      "kraken:BTCUSD": [MAINTENANT - 720 * SEMAINE, 0, MAINTENANT],
    });
    const { profondeur } = await charger();
    expect(profondeur.PLAFOND_BOUGIES_GRAPHE).toBe(20_000);
    expect(profondeur.debutAccessible("binance", "BTCUSDT", "1d")).toBe(date("2017-08-17"));
    expect(profondeur.debutAccessible("binance", "BTCUSDT", "1h")).toBe(MAINTENANT - 20_000 * 3_600_000);
    expect(profondeur.debutAccessible("binance", "BTCUSDT", "1m")).toBe(MAINTENANT - 20_000 * 60_000);
    expect(profondeur.debutAccessible("okx", "BTCUSDT", "1d")).toBe(MAINTENANT - 1_440 * JOUR);
    expect(profondeur.debutAccessible("okx", "BTCUSDT", "1w")).toBe(MAINTENANT - 300 * SEMAINE);
    expect(profondeur.debutAccessible("kraken", "BTCUSD", "1d")).toBe(MAINTENANT - 500 * JOUR);
    expect(profondeur.debutAccessible("kraken", "BTCUSD", "1h")).toBe(MAINTENANT - 500 * 3_600_000);
    // Mois de 30 jours, trimestre/semestre/année proportionnels ; `maintenant` explicite.
    expect(profondeur.debutAccessible("kraken", "BTCUSD", "1M", MAINTENANT + JOUR)).toBe(MAINTENANT - 720 * SEMAINE);
    expect(profondeur.debutAccessible("okx", "BTCUSDT", "12M")).toBe(MAINTENANT - 300 * SEMAINE);
    expect(profondeur.debutAccessible("coinbase", "BTCUSD", "1d")).toBeUndefined();
  });

  it("plancher : le plus ancien début affichable par place ; une borne donne son début au plus tard", async () => {
    precharger({ "coinbase:BTCEUR": [MAINTENANT - 1_400 * JOUR, 0, MAINTENANT], "kraken:BTCUSD": [MAINTENANT - 719 * SEMAINE, 0, MAINTENANT] });
    const { profondeur } = await charger();
    expect(profondeur.plancherAccessible("binance", "1d")).toBe(MAINTENANT - 20_000 * JOUR);
    expect(profondeur.plancherAccessible("okx", "1h")).toBe(MAINTENANT - 1_440 * 3_600_000);
    expect(profondeur.plancherAccessible("kraken", "1d")).toBe(MAINTENANT - 500 * JOUR);
    expect(profondeur.plancherAccessible("coinbase", "1m", MAINTENANT + 60_000)).toBe(MAINTENANT - 19_999 * 60_000);
    // Coinbase arrêté à 4 pages : début réel antérieur ou égal à la borne, jusqu'au plancher.
    expect(profondeur.debutAccessible("coinbase", "BTCEUR", "1d")).toBe(MAINTENANT - 1_400 * JOUR);
    // Borne au-delà du plafond de sa place : ramenée au plancher (500 bougies Kraken).
    expect(profondeur.debutAccessible("kraken", "BTCUSD", "1d")).toBe(MAINTENANT - 500 * JOUR);
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
