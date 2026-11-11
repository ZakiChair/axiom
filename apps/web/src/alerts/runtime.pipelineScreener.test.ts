/**
 * Chargement à la demande du pipeline du screener par les alertes de preset
 * (`chargerPipelineScreener`, alerts/runtime.ts) : fenêtre de chargement et échec.
 *
 * Fichier à part de runtime.test.ts : la fabrique de `../data/screenerRun` y est ASYNCHRONE
 * (porte que le test ouvre, échecs commandés), et chaque test repart d'un registre de
 * modules vide (`vi.resetModules`, fabrique réenregistrée par `vi.doMock`) pour que la
 * promesse mémorisée par le runtime soit neuve.
 * Réseau, WS et daemon bouchonnés comme dans runtime.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AlertePreset } from "../store/presetAlerts";

const { executerScreenerMock, porte } = vi.hoisted(() => ({
  executerScreenerMock: vi.fn(),
  porte: { attendre: Promise.resolve() as Promise<void>, echecs: 0, chargements: 0 },
}));
vi.mock("../data/daemon", () => ({
  daemonPret: () => false,
  daemonSupporte: () => false,
  detectDaemon: async () => false,
  urlDaemon: (chemin: string) => chemin,
  kvPut: async () => null,
}));
vi.mock("../data/ticker", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/ticker")>()),
  subscribeTickers: () => () => {},
}));
vi.mock("../chart/liquidationMarkers", () => ({
  fluxLiqRetenu: () => false,
  liqEventsStore: { getState: () => ({ events: [] }), subscribe: () => () => {} },
}));
vi.mock("../store/regime", () => ({
  regimeStore: { getState: () => ({ regime: null }), subscribe: () => () => {} },
}));

const ALERTE: AlertePreset = {
  id: "p1",
  presetId: "preset-1",
  nom: "Momentum",
  tf: "1h",
  baseConditions: [],
  indicatorConditions: [],
  periodeMin: 15,
  actif: true,
  creeTs: 1,
};

let stop: (() => void) | null = null;

/** Runtime et store NEUFS (la promesse mémorisée du pipeline repart de zéro). */
async function demarrer(): Promise<typeof import("../store/presetAlerts").presetAlertsStore> {
  vi.resetModules();
  porte.chargements = 0;
  // Fabrique réenregistrée à chaque test : sinon son premier résultat resterait servi.
  vi.doMock("../data/screenerRun", async () => {
    porte.chargements += 1;
    await porte.attendre;
    if (porte.echecs > 0) {
      porte.echecs -= 1;
      throw new Error("chunk indisponible");
    }
    return { executerScreener: executerScreenerMock };
  });
  executerScreenerMock.mockReset();
  executerScreenerMock.mockResolvedValue({ rows: [], notes: [] });
  const [{ demarrerAlertes }, { presetAlertsStore }] = await Promise.all([
    import("./runtime"),
    import("../store/presetAlerts"),
  ]);
  presetAlertsStore.setState({ alertes: [ALERTE] });
  stop = demarrerAlertes();
  return presetAlertsStore;
}

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
});

describe("alertes de preset : pipeline du screener chargé à la demande", () => {
  it("alerte retirée pendant le chargement : aucun scan ne part", async () => {
    let ouvrir!: () => void;
    porte.attendre = new Promise<void>((resolve) => {
      ouvrir = resolve;
    });
    porte.echecs = 0;
    const store = await demarrer();
    await vi.waitFor(() => expect(porte.chargements).toBe(1)); // chargement en suspens
    expect(executerScreenerMock).not.toHaveBeenCalled();
    store.getState().retirer("p1");
    ouvrir();
    // Le chargement aboutit, puis on laisse au scan le temps de partir s'il le devait.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(executerScreenerMock).not.toHaveBeenCalled();
    expect(store.getState().alertes).toHaveLength(0);
  });

  it("échec de chargement : publié comme échec de scan, retenté au scan suivant, puis mémorisé", async () => {
    porte.attendre = Promise.resolve();
    porte.echecs = 1;
    // Seuls l'intervalle de scan et Date sont simulés : les attentes restent réelles.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const store = await demarrer();
    await vi.waitFor(() => expect(store.getState().alertes[0]?.derniereErreur).toBeDefined(), { interval: 5 });
    expect(porte.chargements).toBe(1);
    expect(executerScreenerMock).not.toHaveBeenCalled();
    expect(store.getState().alertes[0]?.dernierScanTs).toBeGreaterThan(0);

    // Scan suivant (15 min) : verrou libéré, nouveau chargement, scan réussi, erreur effacée.
    vi.advanceTimersByTime(15 * 60_000);
    await vi.waitFor(() => expect(executerScreenerMock).toHaveBeenCalledTimes(1), { interval: 5 });
    await vi.waitFor(() => expect(store.getState().alertes[0]?.derniereErreur).toBeUndefined(), { interval: 5 });
    expect(porte.chargements).toBe(2);

    // Scan d'après : pas de troisième chargement (promesse mémorisée).
    vi.advanceTimersByTime(15 * 60_000);
    await vi.waitFor(() => expect(executerScreenerMock).toHaveBeenCalledTimes(2), { interval: 5 });
    expect(porte.chargements).toBe(2);
  });
});
