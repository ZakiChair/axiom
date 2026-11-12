/**
 * Amorce du backtest, côté chargement (BT-1, 12 novembre 2026) : bornes passées aux
 * chargeurs simulés. Klines perp chargées depuis l'amorce, mais funding réel demandé depuis
 * la première bougie MESURÉE ; début de chargement jamais avant 1970.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Candle } from "@axiom/types";
import type { WorkerRequest } from "../workers/backtest.worker";
import fixtureBtc from "../../../../packages/indicators/src/strategy/fixtures/btcusdt-4h-3000.json";

type Ligne = [number, number, number, number, number, number, number];
const LIGNES = fixtureBtc.bougies as Ligne[];
const PAS_4H = 14_400_000;
const SEMAINE = 604_800_000;
const JOUR = 86_400_000;
const HORLOGE = LIGNES.at(-1)![0] + PAS_4H + 1_800_000;
const enBougie = ([time, open, high, low, close, volume, buyVolume]: Ligne): Candle =>
  ({ time, open, high, low, close, volume, buyVolume, sellVolume: volume - buyVolume, closed: true });

const { klinesSpot, klinesPerp, reglements } = vi.hoisted(() => ({ klinesSpot: vi.fn(), klinesPerp: vi.fn(), reglements: vi.fn() }));
vi.mock("../data/backtestData", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/backtestData")>()),
  accumulerKlines: klinesSpot,
}));
vi.mock("../data/backtestFunding", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/backtestFunding")>()),
  // Fenêtre perp jusqu'à l'horloge : le dernier mois archivé n'est pas l'objet du test.
  finFenetreFundingArchivee: (t: number) => t,
  accumulerKlinesPerpBinance: klinesPerp,
  fetchReglementsFundingBinance: reglements,
}));
// Chargé une fois en tête : l'import() dynamique du run reçoit le module simulé.
import "../data/backtestFunding";
import { backtestStore } from "./backtest";

let postes: WorkerRequest[] = [];

beforeEach(() => {
  postes = [];
  vi.spyOn(Date, "now").mockReturnValue(HORLOGE);
  // Référence du garde-fou : aucune kline spot servie (la note le dit, sans effet ici).
  vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
  vi.stubGlobal("Worker", class { postMessage(m: WorkerRequest) { postes.push(m); } terminate() {} });
});
afterEach(() => {
  backtestStore.getState().cancel();
  klinesSpot.mockReset(); klinesPerp.mockReset(); reglements.mockReset();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe("amorce et chargeurs", () => {
  it("funding réel : klines perp depuis l'amorce, règlements depuis la première bougie mesurée", async () => {
    klinesPerp.mockImplementation(async (_s: string, _tf: string, debut: number, fin: number): Promise<Candle[]> =>
      LIGNES.filter(([t]) => t >= debut && t + PAS_4H <= fin).map(enBougie));
    reglements.mockResolvedValue({ reglements: [], couverture: { etat: "verifiee", debutMs: 0, finMs: 0, nombre: 0, moisArchives: [], intervallesHeures: [], source: "test" } });
    backtestStore.setState({ symbol: "BTCUSDT", plage: "3m", modeFunding: "binance-reel" });
    backtestStore.getState().loadPreset("builtin:axis");
    backtestStore.getState().run();
    await vi.waitFor(() => { expect(postes).toHaveLength(1); }, { timeout: 10_000 });
    const depuis = HORLOGE - 90 * JOUR;
    expect(klinesPerp).toHaveBeenCalledTimes(1);
    expect(klinesPerp.mock.calls[0]!.slice(0, 4)).toEqual(["BTCUSDT", "4h", depuis - 1500 * PAS_4H, HORLOGE]);
    expect(reglements).toHaveBeenCalledTimes(1);
    // Bougie 2461 (première mesurée), pas 961 (première chargée) ; fin = clôture réelle.
    expect(reglements.mock.calls[0]![1]).toBe(LIGNES[2461]![0]);
    expect(reglements.mock.calls[0]![2]).toBe(LIGNES[2999]![0] + PAS_4H);
    expect(postes[0]!.candles).toHaveLength(2039);
    expect(postes[0]!.params.debutEvaluationMs).toBe(depuis);
    expect(postes[0]!.params.funding).toEqual({ modele: "perp-lineaire", reglements: [] });
    expect(backtestStore.getState().note).toBe("539 bougies mesurées · BTCUSDT 4h · Binance perp · amorce 1500 bougies · référence BTC indisponible : garde-fou de régime non appliqué (signaux de la v2)");
  });

  it("1w : 3 000 bougies d'amorce remonteraient avant 1970, le chargement part de 0 et la note dit l'amorce courte", async () => {
    // 400 semaines closes, la dernière close avant l'horloge.
    const derniere = Math.floor((HORLOGE - SEMAINE) / SEMAINE) * SEMAINE;
    const semaines: Candle[] = Array.from({ length: 400 }, (_, k) => {
      const time = derniere - (399 - k) * SEMAINE;
      return { time, open: 100, high: 101, low: 99, close: 100 + (k % 7), volume: 10, closed: true };
    });
    klinesSpot.mockResolvedValue(semaines);
    backtestStore.setState({ symbol: "BTCUSDT", plage: "2a", modeFunding: "aucun" });
    backtestStore.getState().loadPreset("builtin:axis-sr");
    backtestStore.getState().setTf("1w");
    backtestStore.getState().run();
    await vi.waitFor(() => { expect(postes).toHaveLength(1); }, { timeout: 10_000 });
    expect(klinesSpot).toHaveBeenCalledTimes(1);
    expect(klinesSpot.mock.calls[0]!.slice(0, 4)).toEqual(["BTCUSDT", "1w", 0, HORLOGE]);
    const depuis = HORLOGE - 730 * JOUR;
    const mesurees = semaines.filter((c) => c.time >= depuis).length;
    expect(postes[0]!.params.debutEvaluationMs).toBe(depuis);
    expect(backtestStore.getState().note).toContain(
      `${mesurees} bougies mesurées · BTCUSDT 1w · Binance spot · amorce courte (${400 - mesurees} bougies sur 3000) : premiers signaux pouvant différer de ceux d'une série longue`,
    );
  });
});
