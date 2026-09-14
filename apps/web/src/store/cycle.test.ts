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
  cycleStore.setState({ enCours: false, series: [], mayer: null, mvrv: null, halving: null, erreur: null, majTs: null });
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
