import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { detectDaemonMock } = vi.hoisted(() => ({ detectDaemonMock: vi.fn() }));
vi.mock("../data/daemon", () => ({
  daemonPret: () => false,
  daemonSupporte: () => true,
  detectDaemon: detectDaemonMock,
  urlDaemon: (chemin: string) => chemin,
  kvPut: async () => null,
}));
vi.mock("../data/ticker", () => ({
  isTickerSource: (source: string) => source === "binance",
  subscribeTickers: () => () => {},
}));
vi.mock("../chart/liquidationMarkers", () => ({
  fluxLiqRetenu: () => false,
  liqEventsStore: { getState: () => ({ events: [] }), subscribe: () => () => {} },
}));

import { demarrerAlertes } from "./runtime";
import { alertsStore } from "../store/alerts";
import { presetAlertsStore } from "../store/presetAlerts";
import { cvdDivergenceStore } from "../store/cvd-divergence";

describe("relais heartbeat lors des transitions de l'onglet", () => {
  let stop: (() => void) | undefined;
  let documentTest: EventTarget & { visibilityState: string };
  const fetchMock = vi.fn();
  const heartbeats = () => fetchMock.mock.calls.filter(([url]) => url === "/heartbeat");

  beforeEach(() => {
    vi.useFakeTimers();
    alertsStore.setState({ defs: [], journal: [] });
    presetAlertsStore.setState({ alertes: [] });
    cvdDivergenceStore.setState({ bySymbol: {} });
    detectDaemonMock.mockReset();
    detectDaemonMock.mockResolvedValue(true);
    documentTest = Object.assign(new EventTarget(), { visibilityState: "visible" });
    vi.stubGlobal("document", documentTest);
    vi.stubGlobal("Notification", { permission: "granted" });
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response("{}", { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("transmet immédiatement visible→caché puis caché→visible, sans attendre les 30 s", async () => {
    stop = demarrerAlertes();
    await vi.advanceTimersByTimeAsync(0);
    expect(heartbeats()).toHaveLength(1);
    expect(JSON.parse(heartbeats()[0]?.[1]?.body as string)).toEqual({ visible: true, canNotify: true });

    documentTest.visibilityState = "hidden";
    documentTest.dispatchEvent(new Event("visibilitychange"));
    expect(heartbeats()).toHaveLength(2);
    expect(JSON.parse(heartbeats()[1]?.[1]?.body as string)).toEqual({ visible: false, canNotify: false });

    documentTest.visibilityState = "visible";
    documentTest.dispatchEvent(new Event("visibilitychange"));
    expect(heartbeats()).toHaveLength(3);
    expect(JSON.parse(heartbeats()[2]?.[1]?.body as string)).toEqual({ visible: true, canNotify: true });
  });

  it("retire le listener et le timer à l'arrêt", async () => {
    stop = demarrerAlertes();
    await vi.advanceTimersByTimeAsync(0);
    expect(heartbeats()).toHaveLength(1);
    stop();
    stop = undefined;
    documentTest.visibilityState = "hidden";
    documentTest.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(heartbeats()).toHaveLength(1);
  });

  it("ignore une détection daemon résolue après l'arrêt du runtime", async () => {
    let confirmer!: (present: boolean) => void;
    detectDaemonMock.mockImplementation(() => new Promise<boolean>((resolve) => { confirmer = resolve; }));
    stop = demarrerAlertes();
    stop();
    stop = undefined;
    confirmer(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
