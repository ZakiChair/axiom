/**
 * Tests du client daemon : restauration pilotée par le front et validation stricte
 * du handshake `/health` avant tout envoi de données locales.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isAxiomHealth,
  normaliserUrlDaemonDev,
  URL_DAEMON_DEV_DEFAUT,
} from "./daemon";

const HEALTH_COMPLET = {
  ok: true,
  service: "axiomd",
  apiVersion: 1,
  capabilities: ["kv", "candles", "alerts", "replay", "globe", "snapshots", "proxy"],
  version: "0.1.0",
};

function jsonResponse(corps: unknown, status = 200): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Mock localStorage en mémoire (environnement de test Node, pas de DOM ici). */
function installMockLocalStorage(): Storage {
  const data = new Map<string, string>();
  const mock: Storage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
    key: (i) => Array.from(data.keys())[i] ?? null,
    get length() {
      return data.size;
    },
  };
  (globalThis as { localStorage?: Storage }).localStorage = mock;
  return mock;
}

describe("restaurerSnapshot (client daemon)", () => {
  let localStorage: Storage;
  let restaurerSnapshot: typeof import("./daemon").restaurerSnapshot;

  beforeEach(async () => {
    vi.resetModules();
    ({ restaurerSnapshot } = await import("./daemon"));
    localStorage = installMockLocalStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("réécrit les entrées persist dans localStorage et ignore les autres namespaces", async () => {
    localStorage.setItem("axiom:chartState:v1", '{"symbol":"ETHUSDT"}');
    localStorage.setItem("axiom:alerts:v1", '{"defs":[],"journal":[]}');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(HEALTH_COMPLET))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        id: 3,
        entrees: [
          { namespace: "persist", cle: "axiom:chartState:v1", valeur: '{"symbol":"BTCUSDT"}' },
          { namespace: "persist", cle: "axiom:api-key:evil", valeur: "injectée" },
          { namespace: "alerts", cle: "defs", valeur: [] },
        ],
      }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await restaurerSnapshot(3)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/health");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/kv/snapshots/3/restore");
    expect(localStorage.getItem("axiom:chartState:v1")).toBe('{"symbol":"BTCUSDT"}');
    expect(localStorage.getItem("axiom:api-key:evil")).toBeNull();
    expect(localStorage.getItem("defs")).toBeNull();
    expect(localStorage.getItem("axiom:alerts:v1")).toBe('{"defs":[],"journal":[]}');
  });

  it("réponse non-ok : conserve localStorage et renvoie false", async () => {
    localStorage.setItem("axiom:chartState:v1", '{"symbol":"ETHUSDT"}');
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(jsonResponse(HEALTH_COMPLET))
        .mockResolvedValueOnce(jsonResponse({}, 404)),
    );

    expect(await restaurerSnapshot(9)).toBe(false);
    expect(localStorage.getItem("axiom:chartState:v1")).toBe('{"symbol":"ETHUSDT"}');
  });

  it("refuse la restauration si le daemon n'annonce pas snapshots", async () => {
    localStorage.setItem("axiom:chartState:v1", '{"symbol":"ETHUSDT"}');
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({ ...HEALTH_COMPLET, capabilities: ["kv"] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await restaurerSnapshot(3)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("axiom:chartState:v1")).toBe('{"symbol":"ETHUSDT"}');
  });
});

describe("isAxiomHealth", () => {
  const valid = {
    ok: true,
    service: "axiomd",
    apiVersion: 1,
    capabilities: ["kv", "candles"],
    version: "0.1.0",
  };

  it("accepte uniquement le contrat axiomd courant", () => {
    expect(isAxiomHealth(valid)).toBe(true);
    expect(isAxiomHealth(valid, ["kv", "candles"])).toBe(true);
    expect(isAxiomHealth(valid, ["snapshots"])).toBe(false);
  });

  it("rejette un service étranger qui répond pourtant 200 /health", () => {
    expect(isAxiomHealth({ ...valid, service: "autre-service" })).toBe(false);
  });

  it("rejette une version de protocole incompatible ou un HTML déguisé", () => {
    expect(isAxiomHealth({ ...valid, apiVersion: 2 })).toBe(false);
    expect(isAxiomHealth("<!doctype html>")).toBe(false);
  });
});

describe("normaliserUrlDaemonDev", () => {
  it("utilise un repli loopback sûr et accepte un port local configuré", () => {
    expect(normaliserUrlDaemonDev(undefined)).toBe(URL_DAEMON_DEV_DEFAUT);
    expect(normaliserUrlDaemonDev("http://127.0.0.1:9191")).toBe("http://127.0.0.1:9191");
    expect(normaliserUrlDaemonDev(" http://localhost:9123/ ")).toBe("http://localhost:9123");
  });

  it("refuse une destination externe, HTTPS, userinfo, sous-chemin ou port nul", () => {
    for (const candidate of [
      "https://127.0.0.1:8787",
      "http://evil.example:8787",
      "http://evil@127.0.0.1:8787",
      "http://127.0.0.1:8787/api",
      "http://127.0.0.1:0",
    ]) {
      expect(normaliserUrlDaemonDev(candidate)).toBe(URL_DAEMON_DEV_DEFAUT);
    }
  });
});
