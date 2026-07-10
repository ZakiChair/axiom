/**
 * Test de `restaurerSnapshot` (client daemon) — la restauration PILOTÉE PAR LE FRONT doit
 * réécrire DIRECTEMENT dans localStorage les entrées du namespace « persist » (mêmes clés),
 * sinon la réconciliation au rechargement (hydratation depuis localStorage) annulerait la
 * restauration KV. Les autres namespaces (alerts/notes/portfolio) ne mappent pas 1:1 sur
 * localStorage → ignorés côté front.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { restaurerSnapshot } from "./daemon";

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

  beforeEach(() => {
    localStorage = installMockLocalStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("réécrit les entrées « persist » dans localStorage (mêmes clés) et ignore les autres namespaces", async () => {
    // État « courant » du front que la restauration doit remplacer.
    localStorage.setItem("axiom:chartState:v1", '{"symbol":"ETHUSDT"}');
    localStorage.setItem("axiom:alerts:v1", '{"defs":[],"journal":[]}');

    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            id: 3,
            entrees: [
              // persist : cle == clé localStorage, valeur == chaîne localStorage → réécrit.
              { namespace: "persist", cle: "axiom:chartState:v1", valeur: '{"symbol":"BTCUSDT"}' },
              // alerts : namespace non mappé + valeur non-string → ignoré (aucun setItem("defs")).
              { namespace: "alerts", cle: "defs", valeur: [] },
            ],
          }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const ok = await restaurerSnapshot(3);
    expect(ok).toBe(true);
    // L'entrée persist a été réécrite avec la valeur restaurée (mêmes clés).
    expect(localStorage.getItem("axiom:chartState:v1")).toBe('{"symbol":"BTCUSDT"}');
    // Le namespace alerts n'a PAS pollué localStorage (ni sous "defs", ni sous sa clé propre).
    expect(localStorage.getItem("defs")).toBeNull();
    expect(localStorage.getItem("axiom:alerts:v1")).toBe('{"defs":[],"journal":[]}');
  });

  it("réponse non-ok → false, aucune écriture localStorage", async () => {
    localStorage.setItem("axiom:chartState:v1", '{"symbol":"ETHUSDT"}');
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
    vi.stubGlobal("fetch", fetchMock);

    const ok = await restaurerSnapshot(9);
    expect(ok).toBe(false);
    expect(localStorage.getItem("axiom:chartState:v1")).toBe('{"symbol":"ETHUSDT"}'); // intact
  });
});
