/** Recherche : défaut SYN, libellé/titre des résultats, sélection et anti-rebond des mesures ; gestes réels en E2E. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { clesMesures, JAMBE_B_TRADFI_DEFAUT, libelleSource, planifierMesures, resultatsAMesurer, titreSource } from "./PairSearch";
import { TWELVEDATA_SYMBOLS } from "../data/pairs";
import type { MarketCandidate } from "../data/marketRouting";
import * as profondeur from "../data/profondeurHistorique";

describe("constructeur SYN — jambe B par défaut", () => {
  it("le défaut de la jambe B est un actif tradfi reconnu pour le routage automatique", () => {
    expect(TWELVEDATA_SYMBOLS).toContain(JAMBE_B_TRADFI_DEFAUT);
  });
});

/** HYPEUSDT coté sur trois places, profondeur de Binance encore inconnue (représentant provisoire). */
const HYPE_INCOMPLET: MarketCandidate = { exchange: "binance", symbol: "HYPEUSDT", kind: "spot", places: ["binance", "bybit", "okx"], profondeurIncomplete: true };
const HYPE_MESURE: MarketCandidate = { exchange: "bybit", symbol: "HYPEUSDT", kind: "spot", places: ["bybit", "okx", "binance"] };
const incomplet = (symbol: string): MarketCandidate => ({ exchange: "binance", symbol, kind: "spot", places: ["binance", "bybit"], profondeurIncomplete: true });

describe("recherche — la source affichée est celle qui sera retenue", () => {
  it("HYPEUSDT sans mesure complète affiche « Auto », jamais le nom d'une place non vérifiée", () => {
    expect(libelleSource(HYPE_INCOMPLET)).toBe("Auto");
  });
  it("HYPEUSDT mesuré affiche la place la plus profonde (Bybit)", () => {
    expect(libelleSource(HYPE_MESURE)).toBe("Bybit");
  });
  it("une place seule garde son nom ; OKX, perp Hyperliquid et Twelve Data gardent leurs libellés", () => {
    expect(libelleSource({ exchange: "okx", symbol: "CARDSUSDT", kind: "spot" })).toBe("OKX");
    expect(libelleSource({ exchange: "hyperliquid", symbol: "BTC-PERP", kind: "perp" })).toBe("Perp · Hyperliquid");
    expect(libelleSource({ exchange: "twelvedata", symbol: "GLD", kind: "tradfi" })).toBe("Twelve Data");
  });
  it("le titre liste les places classées de HYPEUSDT et rappelle que la plus profonde est retenue", () => {
    expect(titreSource(HYPE_MESURE)).toBe("Bybit, OKX, Binance — la plus profonde est retenue");
  });
  it("pendant la mesure, le titre liste les places sans ordre provisoire ni gagnant présumé", () => {
    // Le bénéfice du doute place une place non mesurée (souvent Binance) en tête : ne jamais l'afficher comme un classement.
    expect(titreSource(HYPE_INCOMPLET)).toBe("Binance, Bybit, OKX — mesure de l'historique en cours");
    expect(titreSource({ ...HYPE_INCOMPLET, places: ["okx", "binance", "bybit"] })).toBe("Binance, Bybit, OKX — mesure de l'historique en cours");
  });
  it("sans plusieurs places (CARDSUSDT sur OKX seul), aucun titre", () => {
    expect(titreSource({ exchange: "okx", symbol: "CARDSUSDT", kind: "spot" })).toBeUndefined();
  });
});

describe("recherche — mesure paresseuse des premiers résultats", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
  const quinze = Array.from({ length: 15 }, (_, i) => incomplet(`HYPE${i}USDT`));

  it("seuls les 12 premiers résultats (visibles sans défiler) sont mesurés, parmi eux ceux à profondeur incomplète", () => {
    expect(resultatsAMesurer(quinze).map((m) => m.symbol)).toEqual(quinze.slice(0, 12).map((m) => m.symbol));
    const melange = [HYPE_MESURE, { exchange: "okx", symbol: "CARDSUSDT", kind: "spot" } as const, ...Array(10).fill(HYPE_MESURE), HYPE_INCOMPLET];
    expect(resultatsAMesurer(melange)).toEqual([]);
    expect(resultatsAMesurer([HYPE_MESURE, HYPE_INCOMPLET])).toEqual([HYPE_INCOMPLET]);
  });
  it("rien à mesurer quand toutes les places de BTCUSDT et HYPEUSDT sont déjà en cache", () => {
    expect(resultatsAMesurer([HYPE_MESURE, { exchange: "binance", symbol: "BTCUSDT", kind: "spot", places: ["binance", "bybit"] }])).toEqual([]);
  });
  it("après 250 ms d'anti-rebond, une mesure par résultat incomplet, sur ses places, au rang de la recherche (après graphe et favoris)", async () => {
    vi.useFakeTimers();
    const mesurer = vi.spyOn(profondeur, "mesurerProfondeurs").mockResolvedValue();
    planifierMesures([HYPE_MESURE, HYPE_INCOMPLET, incomplet("BTCUSDT")]);
    await vi.advanceTimersByTimeAsync(249);
    expect(mesurer).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const options = { priorite: "recherche", signal: expect.any(AbortSignal) };
    expect(mesurer.mock.calls).toEqual([
      [[{ exchange: "binance", symbol: "HYPEUSDT" }, { exchange: "bybit", symbol: "HYPEUSDT" }, { exchange: "okx", symbol: "HYPEUSDT" }], undefined, options],
      [[{ exchange: "binance", symbol: "BTCUSDT" }, { exchange: "bybit", symbol: "BTCUSDT" }], undefined, options],
    ]);
  });
  it("annulée avant l'échéance (nouvelle frappe, fermeture), aucune mesure ne part", async () => {
    vi.useFakeTimers();
    const mesurer = vi.spyOn(profondeur, "mesurerProfondeurs").mockResolvedValue();
    planifierMesures([HYPE_INCOMPLET])();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mesurer).not.toHaveBeenCalled();
  });
  it("annulée après l'échéance (nouvelle frappe, fermeture, démontage) : les sondes de HYPEUSDT pas encore parties sont abandonnées", async () => {
    vi.useFakeTimers();
    const mesurer = vi.spyOn(profondeur, "mesurerProfondeurs").mockResolvedValue();
    const annuler = planifierMesures([HYPE_INCOMPLET, incomplet("BTCUSDT")]);
    await vi.advanceTimersByTimeAsync(250);
    const signaux = mesurer.mock.calls.map(([, , options]) => options?.signal);
    expect(signaux).toHaveLength(2);
    expect(signaux.some((signal) => signal?.aborted)).toBe(false);
    annuler();
    expect(signaux.every((signal) => signal?.aborted)).toBe(true);
  });
  it("sans résultat incomplet, aucun minuteur n'est posé", () => {
    vi.useFakeTimers();
    planifierMesures([HYPE_MESURE]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("recherche — abandon des mesures au changement de requête, à la fermeture et au démontage", () => {
  const quinze = Array.from({ length: 15 }, (_, i) => incomplet(`HYPE${i}USDT`));

  it("chaque frappe (HYPE puis HYPEU) change les deux clés : les mesures de la requête précédente sont abandonnées", () => {
    const avant = clesMesures([HYPE_INCOMPLET], 0, "HYPE", true);
    const apres = clesMesures([HYPE_INCOMPLET], 0, "HYPEU", true);
    expect(avant.actif).not.toBe("");
    expect(avant.liste).not.toBe("");
    expect(apres.actif).not.toBe(avant.actif);
    expect(apres.liste).not.toBe(avant.liste);
  });
  it("liste fermée (Échap, sélection, perte du focus) : clés vides, plus rien n'est mesuré", () => {
    expect(clesMesures([HYPE_INCOMPLET], 0, "HYPE", false)).toEqual({ actif: "", liste: "" });
  });
  it("une mesure qui aboutit (HYPEUSDT passe d'« Auto » à Bybit, places reclassées) ne change aucune clé : rien n'est abandonné ni replanifié", () => {
    expect(clesMesures([HYPE_MESURE], 0, "HYPE", true)).toEqual(clesMesures([HYPE_INCOMPLET], 0, "HYPE", true));
  });
  it("le résultat actif au-delà des 12 premiers (15e, au clavier ou au survol) a sa propre clé ; la liste des 12 ne bouge pas", () => {
    const premier = clesMesures(quinze, 0, "HYPE", true);
    const quinzieme = clesMesures(quinze, 14, "HYPE", true);
    expect(quinzieme.actif).toContain("HYPE14USDT");
    expect(quinzieme.liste).toBe(premier.liste);
    expect(quinzieme.liste).not.toContain("HYPE14USDT");
  });
  it("une place seule (CARDSUSDT sur OKX) n'a rien à mesurer : clés vides", () => {
    expect(clesMesures([{ exchange: "okx", symbol: "CARDSUSDT", kind: "spot" }], 0, "CARDS", true)).toEqual({ actif: "", liste: "" });
  });
  it("le résultat actif (15e) est mesuré sur ses places, comme les 12 premiers", async () => {
    vi.useFakeTimers();
    const mesurer = vi.spyOn(profondeur, "mesurerProfondeurs").mockResolvedValue();
    planifierMesures([quinze[14]!]);
    await vi.advanceTimersByTimeAsync(250);
    expect(mesurer.mock.calls.map(([places]) => places)).toEqual([[{ exchange: "binance", symbol: "HYPE14USDT" }, { exchange: "bybit", symbol: "HYPE14USDT" }]]);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
});
