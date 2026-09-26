import { describe, expect, it, vi } from "vitest";
import type { CoinTile } from "../data/marketOverview";
import { classerPerformances, estStablecoin, refusesApres, resumePerformances, valeurPeriode, verifierClic, verifierPaire } from "./classementPerformances.util";

/** Tuile de fixture, rangée par capitalisation décroissante comme parseMarkets. */
function tuile(symbol: string, mcapUsd: number, p: Partial<CoinTile> = {}): CoinTile {
  return {
    id: symbol.toLowerCase(), symbol, name: symbol, mcapUsd, price: 10, volume24hUsd: 1e6, observeLe: null,
    changePct24h: 0, changePct7j: 0, changePct30j: 0, changePct1h: 0, ...p,
    changePct24hConnu: p.changePct24hConnu !== undefined ? p.changePct24hConnu : p.changePct24h ?? 0,
  };
}

const MARCHE: CoinTile[] = [
  tuile("BTC", 1_300e9, { changePct24h: 1.2, changePct1h: 0.1, changePct7j: 4 }),
  tuile("ETH", 400e9, { changePct24h: -2.5, changePct1h: -0.4, changePct7j: 9 }),
  tuile("USDT", 180e9, { price: 1.0002, changePct24h: 0.01, changePct1h: 0, changePct7j: 0.02 }),
  tuile("HYPE", 30e9, { changePct24h: 12.4, changePct1h: 1.5, changePct7j: null }),
  tuile("PEPE", 5e9, { changePct24h: -8.1, changePct1h: 2.2, changePct7j: -3 }),
];

describe("classement des performances (façon accueil CoinGlass)", () => {
  it("24 h, hausses : du plus fort gain au plus faible, rang de capitalisation conservé", () => {
    const lignes = classerPerformances(MARCHE, { periode: "24h", sens: "hausses", univers: 250, sansStables: false });
    expect(lignes.map((l) => l.symbol)).toEqual(["HYPE", "BTC", "USDT", "ETH", "PEPE"]);
    expect(lignes.map((l) => l.rang)).toEqual([1, 2, 3, 4, 5]);
    expect(lignes[0]).toMatchObject({ symbol: "HYPE", rangCap: 4 });
  });

  it("baisses : ordre inverse ; les stablecoins sont retirés par défaut", () => {
    const lignes = classerPerformances(MARCHE, { periode: "24h", sens: "baisses", univers: 250, sansStables: true });
    expect(lignes.map((l) => l.symbol)).toEqual(["PEPE", "ETH", "BTC", "HYPE"]);
  });

  it("période 7 j : un actif sans variation connue sort du classement (jamais un 0 inventé)", () => {
    const lignes = classerPerformances(MARCHE, { periode: "7j", sens: "hausses", univers: 250, sansStables: true });
    expect(lignes.map((l) => l.symbol)).toEqual(["ETH", "BTC", "PEPE"]);
  });

  it("Δ24 h inconnu (FIGR_HELOC réel) : hors du classement 24 h et de la médiane, présent en 7 j", () => {
    const avecInconnu = [...MARCHE, tuile("FIGR_HELOC", 23.7e9, { price: 1.02, changePct24h: 0, changePct24hConnu: null, changePct7j: -0.63 })];
    const lignes = classerPerformances(avecInconnu, { periode: "24h", sens: "hausses", univers: 250, sansStables: true });
    expect(lignes.map((l) => l.symbol)).not.toContain("FIGR_HELOC");
    expect(resumePerformances(lignes, "24h").mediane).toBe((1.2 + -2.5) / 2);
    expect(classerPerformances(avecInconnu, { periode: "7j", sens: "hausses", univers: 250, sansStables: true }).map((l) => l.symbol)).toContain("FIGR_HELOC");
  });

  it("univers : seuls les N premiers par capitalisation concourent", () => {
    const lignes = classerPerformances(MARCHE, { periode: "1h", sens: "hausses", univers: 2, sansStables: true });
    expect(lignes.map((l) => l.symbol)).toEqual(["BTC", "ETH"]);
  });

  it("valeur d'une période et résumé hausses / baisses / médiane", () => {
    expect(valeurPeriode(MARCHE[3]!, "1h")).toBe(1.5);
    expect(valeurPeriode(MARCHE[3]!, "7j")).toBeNull();
    const lignes = classerPerformances(MARCHE, { periode: "24h", sens: "hausses", univers: 250, sansStables: true });
    expect(resumePerformances(lignes, "24h")).toEqual({ hausses: 2, baisses: 2, mediane: (1.2 + -2.5) / 2 });
    expect(resumePerformances([], "24h")).toEqual({ hausses: 0, baisses: 0, mediane: null });
  });

  it("stablecoins : liste connue, ou prix ancré à 1 $ sans mouvement", () => {
    expect(estStablecoin(tuile("USDC", 1, { price: 1 }))).toBe(true);
    expect(estStablecoin(tuile("NEWUSD", 1, { price: 0.9995, changePct24h: 0.02, changePct7j: 0.05 }))).toBe(true);
    // Un actif à 1 $ qui bouge n'est pas un stablecoin.
    expect(estStablecoin(tuile("XRP", 1, { price: 1.01, changePct24h: 3.2, changePct7j: 6 }))).toBe(false);
    expect(estStablecoin(tuile("PAXG", 1, { price: 2_400 }))).toBe(false);
  });
});

describe("garde du clic : la paire ouverte est bien l'actif de la ligne", () => {
  const ai = { symbol: "AI", name: "Artificial Inu", price: 0.258 };
  it("première place du routage cotée et cohérente, autres places cohérentes : navigation sur cette place", () => {
    expect(verifierPaire({ symbol: "ETH", name: "Ethereum", price: 2_690 }, [{ exchange: "okx", prix: 2_688 }, { exchange: "binance", prix: 2_687 }], "binance"))
      .toEqual({ ok: true, paire: "ETHUSDT", exchange: "binance" });
  });
  it("ticker partagé par un autre actif (AIUSDT = Sleepless AI à 0,0203 $) : refus d'IDENTITÉ, raison explicite", () => {
    const v = verifierPaire(ai, [{ exchange: "binance", prix: 0.0203 }, { exchange: "okx", prix: 0.0217 }], "binance");
    expect(v).toMatchObject({ ok: false, motif: "identite" });
    expect(v.ok === false && v.raison).toMatch(/AIUSDT.*Binance.*Artificial Inu/);
  });
  it("une seule place incohérente suffit, même si ce n'est pas la première du routage", () => {
    expect(verifierPaire({ symbol: "FRAX", name: "Legacy Frax Dollar", price: 0.99 }, [{ exchange: "coinbase", prix: 0.99 }, { exchange: "bybit", prix: 0.306 }], "coinbase"))
      .toMatchObject({ ok: false, motif: "identite" });
  });
  it("prix inconnu sur la première place du routage (Binance muet, autres cohérents) : vérification incomplète, NON collante", () => {
    const v = verifierPaire(ai, [{ exchange: "binance", prix: undefined }, { exchange: "kraken", prix: 0.26 }], "binance");
    expect(v).toMatchObject({ ok: false, motif: "indisponible" });
    expect(v.ok === false && v.raison).toMatch(/incomplète.*réessayez/i);
  });
  it("aucune place confirmée par le routage, ou aucun prix : vérification incomplète", () => {
    expect(verifierPaire(ai, [{ exchange: "binance", prix: 0.258 }], undefined)).toMatchObject({ ok: false, motif: "indisponible" });
    expect(verifierPaire(ai, [], "binance")).toMatchObject({ ok: false, motif: "indisponible" });
  });
  it("bande ×0,8 – ×1,25, bornes incluses", () => {
    expect(verifierPaire(ai, [{ exchange: "binance", prix: 0.258 * 0.8 }], "binance").ok).toBe(true);
    expect(verifierPaire(ai, [{ exchange: "binance", prix: 0.258 * 1.25 }], "binance").ok).toBe(true);
    expect(verifierPaire(ai, [{ exchange: "binance", prix: 0.258 * 1.26 }], "binance")).toMatchObject({ ok: false, motif: "identite" });
  });
  it("seul un refus d'identité désactive la ligne ; une vérification incomplète laisse réessayer", () => {
    const refusees = new Map<string, string>();
    const incomplet = verifierPaire(ai, [{ exchange: "binance", prix: undefined }], "binance");
    expect(refusesApres(refusees, "artificial-inu-3", incomplet).has("artificial-inu-3")).toBe(false);
    const identite = verifierPaire(ai, [{ exchange: "binance", prix: 0.0203 }], "binance");
    expect(refusesApres(refusees, "artificial-inu-3", identite).has("artificial-inu-3")).toBe(true);
  });
});

describe("clic sur une ligne : mesures dès le clic, refus d'identité avant le résolveur (fusion avec le routage par profondeur)", () => {
  const ai = { symbol: "AI", name: "Sleepless AI", price: 0.3 };
  const hype = { symbol: "HYPE", name: "Hyperliquid", price: 92 };
  const deps = (prix: Record<string, number | undefined>, premiere: string | undefined, courant = () => true) => ({
    prix: vi.fn(async (exchange: string) => prix[exchange]),
    mesurer: vi.fn(),
    premiere: vi.fn(async () => premiere as never),
    courant,
  });

  it("AIUSDT dont un prix connu désigne un autre actif : refus d'identité SANS appeler le résolveur", async () => {
    const d = deps({ binance: 0.0203, okx: 0.0217 }, "binance");
    const v = await verifierClic(ai, ["binance", "okx"], d);
    expect(v).toMatchObject({ ok: false, motif: "identite" });
    expect(d.premiere).not.toHaveBeenCalled();
  });

  it("les mesures de profondeur partent dès le clic, avant la réponse des prix", async () => {
    let repondre!: () => void;
    const attente = new Promise<void>((ok) => { repondre = ok; });
    const d = { ...deps({}, "bybit"), prix: vi.fn(async () => { await attente; return 92; }) };
    const promesse = verifierClic(hype, ["bybit", "okx", "binance"], d);
    expect(d.mesurer).toHaveBeenCalledWith(["bybit", "okx", "binance"], "HYPEUSDT");
    repondre();
    expect(await promesse).toEqual({ ok: true, paire: "HYPEUSDT", exchange: "bybit" });
  });

  it("clic dépassé (clic plus récent ou démontage) : aucun verdict, résolveur jamais appelé", async () => {
    const d = deps({ bybit: 92 }, "bybit", () => false);
    expect(await verifierClic(hype, ["bybit"], d)).toBeNull();
    expect(d.premiere).not.toHaveBeenCalled();
  });

  it("prix cohérents : la place validée est la première du résolveur (HYPEUSDT → Bybit)", async () => {
    const d = deps({ bybit: 92.1, okx: 92, binance: 91.9 }, "bybit");
    expect(await verifierClic(hype, ["bybit", "okx", "binance"], d)).toEqual({ ok: true, paire: "HYPEUSDT", exchange: "bybit" });
    expect(d.premiere).toHaveBeenCalledWith("HYPEUSDT");
  });
});
