/**
 * Tests du store CYCLE — orchestration réseau (les calculs purs sont couverts par
 * data/cycle.test.ts). Collectes mockées ; `decouperCycles`/`mayerMultiple` restent réels.
 * Correctif B (décision du 2026-09-14) : MVRV Z-Score BGeometrics SEUL, aucun repli
 * Coin Metrics — la seule collecte Coin Metrics de CYCLE est l'historique PriceUSD.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BgResultat } from "../data/onchain/bgeometrics";
import type { PointMetrique } from "../data/onchain/coinmetrics";

const JOUR = 86_400_000;

const prix = vi.fn();
const cmMetriques = vi.fn();
const mempool = vi.fn();
const bg = vi.fn();

vi.mock("../data/onchain/coinmetrics", () => ({
  fetchCoinMetricsPriceUSDComplet: () => prix(),
  // Collecte multi-métriques (dont CapMVRVCur) : ne doit JAMAIS être appelée par CYCLE.
  fetchCoinMetrics: (...args: unknown[]) => cmMetriques(...args),
}));
vi.mock("../data/onchain/mempool", () => ({ fetchMempoolReseau: () => mempool() }));
vi.mock("../data/onchain/bgeometrics", () => ({
  BG_MVRV: { id: "mvrv", chemin: "mvrv-zscore", champ: "mvrvZscore", libelle: "MVRV Z-Score", embargo: true },
  fetchBgeometricMetrique: (def: { id: string }, cle: string | null) => bg(def.id, cle),
}));
vi.mock("./onchain", () => ({ getBgeometricsKey: () => null }));

import { cycleStore } from "./cycle";

/** Historique quotidien synthétique couvrant le halving 2024 (points 00:00 UTC). */
function historique(): PointMetrique[] {
  const debut = Date.UTC(2024, 3, 20);
  return Array.from({ length: 300 }, (_, i) => ({ time: debut + i * JOUR, value: 60_000 + 10 * i }));
}

/** Résultat BGeometrics à J-7 (offre gratuite sous embargo). */
function resultatBg(valeur: number): BgResultat {
  const dernier = { time: Date.UTC(2026, 8, 7), value: valeur };
  return { serie: { points: [dernier], dernier }, ts: Date.UTC(2026, 8, 14, 12), perime: true, repli: false };
}

beforeEach(() => {
  vi.clearAllMocks();
  prix.mockResolvedValue({ points: historique(), ts: 1, perime: false });
  mempool.mockResolvedValue(null);
  cmMetriques.mockResolvedValue({ series: { CapMVRVCur: { points: [], dernier: { time: 1, value: 1.7 } } } });
});

afterEach(() => {
  cycleStore.setState({
    enCours: false,
    series: [],
    ath: null,
    modeles: null,
    mayer: null,
    mvrv: null,
    halving: null,
    erreur: null,
    majTs: null,
  });
});

describe("cycleStore — MVRV Z-Score (BGeometrics seul)", () => {
  it("conserve le résultat BGeometrics (valeur et fraîcheur) pour la mention d'embargo", async () => {
    const r = resultatBg(1.23);
    bg.mockResolvedValue(r);
    await cycleStore.getState().run(true);
    const etat = cycleStore.getState();
    expect(etat.series.length).toBeGreaterThan(0);
    expect(etat.mvrv).toEqual(r);
    expect(bg).toHaveBeenCalledWith("mvrv", null);
    expect(cmMetriques).not.toHaveBeenCalled();
  });

  it("BGeometrics indisponible (null) : « — », sans repli Coin Metrics CapMVRVCur", async () => {
    bg.mockResolvedValue(null);
    await cycleStore.getState().run(true);
    expect(cycleStore.getState().mvrv).toBeNull();
    expect(cmMetriques).not.toHaveBeenCalled();
    expect(prix).toHaveBeenCalledTimes(1);
  });

  it("BGeometrics en erreur : « — », sans repli ni échec du chart", async () => {
    bg.mockRejectedValue(new Error("503"));
    await cycleStore.getState().run(true);
    const etat = cycleStore.getState();
    expect(etat.mvrv).toBeNull();
    expect(etat.series.length).toBeGreaterThan(0);
    expect(etat.erreur).toBeNull();
    expect(cmMetriques).not.toHaveBeenCalled();
  });

  it("série BGeometrics sans dernière observation : « — », jamais une valeur inventée", async () => {
    bg.mockResolvedValue({ serie: { points: [], dernier: undefined }, ts: 1, perime: false, repli: false });
    await cycleStore.getState().run(true);
    expect(cycleStore.getState().mvrv).toBeNull();
    expect(cmMetriques).not.toHaveBeenCalled();
  });
});

describe("cycleStore — distance à l'ATH (calculée dans run)", () => {
  it("expose la distance à l'ATH sans conserver l'historique brut ; un pic passé hors données reste null", async () => {
    bg.mockResolvedValue(null);
    await cycleStore.getState().run(true);
    const etat = cycleStore.getState();
    // Aucun consommateur de l'historique brut : il n'est pas gardé dans l'état.
    expect(etat).not.toHaveProperty("points");
    // historique() croît : ATH au dernier point, aucun pic passé couvert par les données.
    expect(etat.ath).not.toBeNull();
    expect(etat.ath!.athMs).toBe(Date.UTC(2024, 3, 20) + 299 * JOUR);
    expect(etat.ath!.joursDepuisAth).toBe(0);
    expect(etat.ath!.repliMaxPct).toBe(0);
    expect(etat.ath!.cyclesPasses).toEqual({ 1: null, 2: null, 3: null });
  });

  it("compare au même J+N depuis le pic 2021 quand l'historique le couvre", async () => {
    bg.mockResolvedValue(null);
    const pic2021 = Date.UTC(2021, 10, 8);
    const avant = Array.from({ length: 20 }, (_, i) => ({ time: pic2021 + i * JOUR, value: 100 - i }));
    const courant = historique().map((p, i) => (i === 290 ? { ...p, value: 200_000 } : p));
    prix.mockResolvedValue({ points: [...avant, ...courant], ts: 1, perime: false });
    await cycleStore.getState().run(true);
    const ath = cycleStore.getState().ath!;
    expect(ath.joursDepuisAth).toBe(9);
    expect(ath.cyclesPasses[3]!.repliPct).toBeCloseTo(-9, 10);
    expect(ath.cyclesPasses[1]).toBeNull();
  });
});

describe("cycleStore — modèles de prix (calculés dans run)", () => {
  it("calcule les trois modèles une fois par run sur un historique suffisant", async () => {
    bg.mockResolvedValue(null);
    const debut = Date.UTC(2020, 4, 11);
    const points = Array.from({ length: 1500 }, (_, i) => ({ time: debut + i * JOUR, value: 10_000 + 20 * i }));
    prix.mockResolvedValue({ points, ts: 1, perime: false });
    await cycleStore.getState().run(true);
    const { modeles } = cycleStore.getState();
    expect(modeles).not.toBeNull();
    // Série croissante : prix au-dessus de ses moyennes depuis le premier ratio calculable.
    expect(modeles!.multiple200Semaines!.ratio).toBeGreaterThan(1);
    expect(modeles!.multiple200Semaines!.sequence).toEqual({ sens: "dessus", jours: 101, depuisMs: debut + 1399 * JOUR });
    expect(modeles!.ratio2Ans).not.toBeNull();
    expect(modeles!.piCycleBottom).not.toBeNull();
  });

  it("historique trop court : chaque modèle reste null, jamais une valeur inventée", async () => {
    bg.mockResolvedValue(null);
    await cycleStore.getState().run(true);
    expect(cycleStore.getState().modeles).toEqual({ multiple200Semaines: null, ratio2Ans: null, piCycleBottom: null });
  });
});
