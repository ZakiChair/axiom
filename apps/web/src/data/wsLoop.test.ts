/**
 * connectWsLoop — cœur de résilience réseau partagé par les adaptateurs (reconnexion,
 * backoff exponentiel anti-flap, watchdog de staleness). Testé avec un WebSocket mocké
 * + fake timers : déterministe, sans réseau. Vérifie les invariants documentés en tête
 * de wsLoop.ts (backoff non remis à zéro dans onopen, reset au 1er message de données,
 * onReconnected dès la 1re connexion (raccord backfill→WS), fermeture forcée d'une socket zombie).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { connectWsLoop } from "./wsLoop";

/** WebSocket mocké : enregistre les instances, expose des déclencheurs manuels. */
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }
  // Déclencheurs de test.
  déclencherOpen(): void {
    this.onopen?.();
  }
  déclencherMessage(data: string): void {
    this.onmessage?.({ data });
  }
}

function dernière(): MockWebSocket {
  const w = MockWebSocket.instances[MockWebSocket.instances.length - 1];
  if (!w) throw new Error("aucune socket créée");
  return w;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("connectWsLoop", () => {
  it("appelle onOpen ET onReconnected (resync) dès la 1re connexion — raccord backfill→WS", () => {
    // Des bougies peuvent clôturer entre l'instantané REST du backfill et le premier
    // message WS (systématique en 1s) : le resync doit aussi couvrir la 1re connexion.
    const onOpen = vi.fn();
    const onReconnected = vi.fn();
    connectWsLoop({ url: "wss://x", source: "test", onMessage: () => true, onOpen, onReconnected });

    expect(MockWebSocket.instances).toHaveLength(1);
    dernière().déclencherOpen();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onReconnected).toHaveBeenCalledTimes(1);
  });

  it("reconnecte après une fermeture, avec backoff exponentiel, et appelle onReconnected", () => {
    const onReconnected = vi.fn();
    connectWsLoop({ url: "wss://x", source: "test", onMessage: () => false, onReconnected });

    dernière().déclencherOpen(); // 1re connexion établie
    dernière().close(); // chute → reconnexion planifiée à 1000ms (2^0)

    expect(MockWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(999);
    expect(MockWebSocket.instances).toHaveLength(1); // pas encore
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(2); // reconnexion #1

    dernière().déclencherOpen();
    expect(onReconnected).toHaveBeenCalledTimes(2); // 1re connexion + RE-connexion
    dernière().close(); // 2e chute → délai 2000ms (2^1, backoff non remis à zéro)

    vi.advanceTimersByTime(1999);
    expect(MockWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(3); // reconnexion #2 (backoff doublé)
  });

  it("un message de DONNÉES remet le backoff à zéro (délai suivant = 1000ms)", () => {
    connectWsLoop({ url: "wss://x", source: "test", onMessage: (d) => d === "data" });

    dernière().déclencherOpen();
    dernière().close(); // délai 1000 (attempt 0→1)
    vi.advanceTimersByTime(1000);
    dernière().déclencherOpen(); // reconnexion #1 (attempt=1)
    dernière().déclencherMessage("data"); // onMessage true → attempt remis à 0
    dernière().close(); // délai doit repartir à 1000 (2^0), pas 2000

    vi.advanceTimersByTime(999);
    expect(MockWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(3); // confirmé : backoff réarmé
  });

  it("le watchdog ferme une socket silencieuse après staleMs et relance", () => {
    connectWsLoop({ url: "wss://x", source: "test", onMessage: () => true, staleMs: 1000 });
    dernière().déclencherOpen();

    // Watchdog (interval 1000ms) : tick à t=1000 → diff 1000 ≤ staleMs (sain) ; tick à
    // t=2000 → diff 2000 > staleMs → fermeture forcée de la socket zombie → reconnexion.
    vi.advanceTimersByTime(2000);
    expect(dernière().closed).toBe(true);
    vi.advanceTimersByTime(1000); // délai de reconnexion (backoff 2^0)
    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2);
  });

  it("unsubscribe ferme la socket et n'ouvre plus de reconnexion", () => {
    const stop = connectWsLoop({ url: "wss://x", source: "test", onMessage: () => true });
    dernière().déclencherOpen();

    stop();
    expect(dernière().closed).toBe(true);
    // Même en avançant longuement, aucune nouvelle socket (fermeture volontaire).
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
