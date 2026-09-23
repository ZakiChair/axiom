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
import { lireLectures } from "./analyseMultidomaine";

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
  it("publie toujours la médiane 1 min, inconnue pendant la chauffe puis chiffrée", async () => {
    transport.fetchOi.mockResolvedValue([]);
    transport.fetchKlines.mockResolvedValue([]);
    const release = retenirDiagnosticMicrostructure();
    try {
      const souscription = transport.souscrireDepth.mock.calls.at(-1) as unknown as [string, (livre: OrderBook) => void, () => void];
      souscription[1]({ lastUpdateId: 1, bids: new Map([[99, 1_000]]), asks: new Map([[101, 1_000]]) });
      await vi.advanceTimersByTimeAsync(1_000);
      const premiere = lireLectures(Date.now()).find((l) => l.domaine === "liquidite" && l.id.includes("achat"));
      expect(premiere?.valeur).toBeNull();
      expect(premiere?.conclusion).toContain("Médiane");
      for (let i = 2; i <= 20; i++) {
        souscription[1]({ lastUpdateId: i, bids: new Map([[99, 1_000]]), asks: new Map([[101, 1_000]]) });
        await vi.advanceTimersByTimeAsync(1_000);
      }
      const chauffeTerminee = lireLectures(Date.now()).find((l) => l.id === premiere?.id);
      expect(chauffeTerminee?.valeur).toBe(100);
      expect(chauffeTerminee?.conclusion).toContain("Médiane");
    } finally {
      release();
    }
  });

  it("publie la vraie devise de cotation et refuse une identité inconnue", async () => {
    transport.fetchOi.mockResolvedValue([]);
    transport.fetchKlines.mockResolvedValue([]);
    marchePrete("ETHBTC");
    const release = retenirDiagnosticMicrostructure();
    const souscription = transport.souscrireDepth.mock.calls.at(-1) as unknown as [string, (livre: OrderBook) => void, () => void];
    souscription[1]({ lastUpdateId: 1, bids: new Map([[0.049, 100_000]]), asks: new Map([[0.051, 100_000]]) });
    await vi.advanceTimersByTimeAsync(1_000);
    const v = microstructureDiagnosticStore.getState().vue;
    expect(v.cotation).toBe("BTC");
    expect(lireLectures(Date.now()).find((l) => l.id.includes("achat"))?.conclusion).toContain(" BTC");

    marchePrete("BTCXYZ");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(microstructureDiagnosticStore.getState().vue.cotation).toBeNull();
    expect(microstructureDiagnosticStore.getState().vue.stabilite).toBeNull();
    expect(lireLectures(Date.now()).find((l) => l.domaine === "liquidite")?.statut).toBe("indisponible");
    release();
  });

  it("garde la lecture L2 quand seul le flux chart se reconnecte", async () => {
    transport.fetchOi.mockResolvedValue([]);
    transport.fetchKlines.mockResolvedValue([]);
    const release = retenirDiagnosticMicrostructure();
    const souscription = transport.souscrireDepth.mock.calls.at(-1) as unknown as [string, (livre: OrderBook) => void, () => void];
    souscription[1]({ lastUpdateId: 1, bids: new Map([[99, 1_000]]), asks: new Map([[101, 1_000]]) });
    healthStore.getState().setEtat("binance", "reconnecting");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(microstructureDiagnosticStore.getState().vue.stabilite?.fenetres[1].achat.observations).toBe(1);
    release();
  });

  it("échantillonne le carnet partagé puis réarme sur montant et reset L2", async () => {
    transport.fetchOi.mockResolvedValue([]);
    transport.fetchKlines.mockResolvedValue([]);
    const release = retenirDiagnosticMicrostructure();
    const souscription = transport.souscrireDepth.mock.calls.at(-1) as unknown as [string, (livre: OrderBook) => void, () => void];
    expect(souscription[0]).toBe("BTCUSDT");
    souscription[1]({ lastUpdateId: 1, bids: new Map([[99, 1_000]]), asks: new Map([[101, 1_000]]) });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(microstructureDiagnosticStore.getState().vue.stabilite?.fenetres[1].achat.observations).toBe(1);
    const preuveInitiale = lireLectures(Date.now()).find((l) => l.domaine === "liquidite" && l.instrument?.symbol === "BTCUSDT");
    expect(preuveInitiale).toBeDefined();
    await vi.advanceTimersByTimeAsync(1_000);
    const preuveRelue = lireLectures(Date.now()).find((l) => l.id === preuveInitiale?.id);
    expect(preuveRelue?.recupereLe).toBe(preuveInitiale?.recupereLe);

    microstructureDiagnosticStore.getState().setNotionnelLiquidite(50_000);
    expect(microstructureDiagnosticStore.getState().vue.stabilite?.fenetres[1].achat.observations ?? 0).toBe(0);
    souscription[2]();
    expect(microstructureDiagnosticStore.getState().vue.stabilite).toBeNull();
    release();
  });

  it("cesse d'attribuer l'ancien carnet au nouveau symbole", async () => {
    transport.fetchOi.mockResolvedValue([]);
    transport.fetchKlines.mockResolvedValue([]);
    const release = retenirDiagnosticMicrostructure();
    const ancienne = transport.souscrireDepth.mock.calls.at(-1) as unknown as [string, (livre: OrderBook) => void, () => void];
    ancienne[1]({ lastUpdateId: 1, bids: new Map([[99, 1_000]]), asks: new Map([[101, 1_000]]) });
    await vi.advanceTimersByTimeAsync(1_000);
    marchePrete("ETHUSDT");
    await vi.advanceTimersByTimeAsync(1_000);
    const nouvelle = transport.souscrireDepth.mock.calls.at(-1) as unknown as [string, (livre: OrderBook) => void, () => void];
    expect(nouvelle[0]).toBe("ETHUSDT");
    expect(microstructureDiagnosticStore.getState().vue.stabilite?.fenetres[1].achat.observations ?? 0).toBe(0);
    ancienne[1]({ lastUpdateId: 2, bids: new Map([[99, 1_000]]), asks: new Map([[101, 1_000]]) });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(microstructureDiagnosticStore.getState().vue.stabilite?.fenetres[1].achat.observations ?? 0).toBe(0);
    release();
  });

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
