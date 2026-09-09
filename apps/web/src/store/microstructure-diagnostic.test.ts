import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderBook } from "../data/depth";
import {
  calculerCoutsCarnet,
  doitReinitialiserDiagnostic,
  reponseCollecteValide,
  type ContexteDiagnostic,
} from "./microstructure-diagnostic";
import { microstructureDiagnosticStore, retenirDiagnosticMicrostructure } from "./microstructure-diagnostic";
import { healthStore } from "./health";
import { marketStore } from "./market";

const transport = vi.hoisted(() => ({
  fetchOi: vi.fn(),
  fetchKlines: vi.fn(),
  souscrireDepth: vi.fn(() => vi.fn()),
}));

vi.mock("../data/binanceFutures", () => ({ fetchOpenInterestHist: transport.fetchOi }));
vi.mock("../data/binance", () => ({ binanceAdapter: { fetchKlines: transport.fetchKlines } }));
vi.mock("../data/depth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/depth")>()),
  souscrireDepth: transport.souscrireDepth,
}));

function differee<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function marchePrete(symbol = "BTCUSDT") {
  const state = marketStore.getState();
  state.setMarket({ exchange: "binance", symbol, timeframe: "1h" });
  const courant = marketStore.getState();
  const identity = { exchange: "binance" as const, symbol, timeframe: "1h" as const };
  courant.completeDataLoad(identity, courant.dataLoad.requestId, []);
  healthStore.getState().setEtat("binance", "connected");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-09T12:00:00Z"));
  transport.fetchOi.mockReset();
  transport.fetchKlines.mockReset();
  transport.souscrireDepth.mockClear();
  microstructureDiagnosticStore.getState().reset();
  marchePrete();
});

afterEach(() => {
  vi.useRealTimers();
});

const PRET: ContexteDiagnostic = {
  exchange: "binance",
  symbol: "BTCUSDT",
  timeframe: "1m",
  requestId: 4,
  pret: true,
  connecte: true,
};

describe("cycle du diagnostic microstructure partagé DOM/EQS", () => {
  it("conserve la session identique et reset au changement de marché ou de génération", () => {
    expect(doitReinitialiserDiagnostic(PRET, { ...PRET })).toBe(false);
    expect(doitReinitialiserDiagnostic(PRET, { ...PRET, symbol: "ETHUSDT" })).toBe(true);
    expect(doitReinitialiserDiagnostic(PRET, { ...PRET, exchange: "kraken" })).toBe(true);
    expect(doitReinitialiserDiagnostic(PRET, { ...PRET, requestId: 5 })).toBe(true);
  });

  it("reset au chargement, à la déconnexion et à la reconnexion", () => {
    expect(doitReinitialiserDiagnostic(PRET, { ...PRET, pret: false })).toBe(true);
    expect(doitReinitialiserDiagnostic(PRET, { ...PRET, connecte: false })).toBe(true);
    expect(doitReinitialiserDiagnostic({ ...PRET, connecte: false }, PRET)).toBe(true);
  });

  it("ignore une réponse réseau tardive après release ou nouvelle génération", () => {
    expect(reponseCollecteValide(4, 4, 1, "btc:4", "btc:4", true)).toBe(true);
    expect(reponseCollecteValide(4, 5, 1, "btc:4", "btc:4", true)).toBe(false);
    expect(reponseCollecteValide(4, 4, 0, "btc:4", "btc:4", true)).toBe(false);
    expect(reponseCollecteValide(4, 4, 1, "btc:4", "eth:4", true)).toBe(false);
  });
});

describe("fraîcheur du coût d'exécution", () => {
  it("cesse d'afficher le coût dès que le carnet partagé est périmé", () => {
    const livre: OrderBook = {
      lastUpdateId: 1,
      bids: new Map([[99, 1_000]]),
      asks: new Map([[101, 1_000]]),
    };
    expect(calculerCoutsCarnet(livre, 1_000, 5_000, 5_000)).toHaveLength(4);
    expect(calculerCoutsCarnet(livre, 1_000, 6_001, 5_000)).toEqual([]);
  });
});

describe("collecteur à la demande", () => {
  it("ignore les réponses résolues après le dernier release", async () => {
    const oi = differee<never[]>();
    const klines = differee<never[]>();
    transport.fetchOi.mockReturnValueOnce(oi.promise);
    transport.fetchKlines.mockReturnValueOnce(klines.promise);
    const release = retenirDiagnosticMicrostructure();
    await vi.waitFor(() => expect(transport.fetchOi).toHaveBeenCalledTimes(1));
    release();
    oi.resolve([]);
    klines.resolve([]);
    await Promise.resolve();
    await Promise.resolve();
    expect(microstructureDiagnosticStore.getState().vue.statut).toBe("Diagnostic arrêté");
    expect(microstructureDiagnosticStore.getState().vue.diagnostic).toBeNull();
  });

  it("relance les deux historiques après config puis changement de symbole", async () => {
    const oi1 = differee<never[]>();
    const k1 = differee<never[]>();
    transport.fetchOi.mockReturnValueOnce(oi1.promise).mockResolvedValue([]);
    transport.fetchKlines.mockReturnValueOnce(k1.promise).mockResolvedValue([]);
    const release = retenirDiagnosticMicrostructure();
    await vi.waitFor(() => expect(transport.fetchKlines).toHaveBeenCalledTimes(1));

    microstructureDiagnosticStore.getState().setConfig({ seuilPrixPct: 0.7 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(transport.fetchOi).toHaveBeenCalledTimes(2);
    expect(transport.fetchKlines).toHaveBeenCalledTimes(2);
    // La nouvelle génération repart sans attendre les deux anciennes requêtes.
    // Leur résolution tardive ne doit ensuite effacer aucune donnée de la reprise.
    oi1.resolve([]); k1.resolve([]);
    await Promise.resolve(); await Promise.resolve();

    marchePrete("ETHUSDT");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(transport.fetchOi).toHaveBeenCalledTimes(3);
    expect(transport.fetchKlines).toHaveBeenCalledTimes(3);
    release();
  });
});
