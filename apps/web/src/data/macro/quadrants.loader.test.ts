import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chargerQuadrants } from "./quadrants";
import { macroSeriesStore } from "../../store/macroSeries";

interface RequeteDifferee { id: string; terminer: () => void }
const observations = (id: string) => (id === "GDPC1" ? [["2026-04-01", 2.1]]
  : (id === "INDPRO" ? [1, 1.2, 1.5, 2] : [3, 2.8, 2.5, 2]).map((valeur, i) => [new Date(Date.UTC(2026, i + 3, 1)).toISOString().slice(0, 10), valeur]));

beforeEach(() => {
  const valeurs = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (cle: string) => valeurs.get(cle) ?? null,
    setItem: (cle: string, valeur: string) => { valeurs.set(cle, valeur); },
    removeItem: (cle: string) => { valeurs.delete(cle); },
    clear: () => { valeurs.clear(); },
    key: (index: number) => [...valeurs.keys()][index] ?? null,
    get length() { return valeurs.size; },
  });
  macroSeriesStore.setState({ series: {} });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); macroSeriesStore.setState({ series: {} }); });

describe("chargement coordonné des quadrants", () => {
  it("attend la requête CPI concurrente gagnante avant de figer et publier le snapshot", async () => {
    const requetes: RequeteDifferee[] = [];
    vi.stubGlobal("fetch", vi.fn((raw: string) => new Promise((resolve) => {
      const id = new URL(raw, "http://localhost").searchParams.get("series_id")!;
      requetes.push({ id, terminer: () => resolve({ ok: true, status: 200, statusText: "OK", json: async () => ({ observations: observations(id).map(([date, value]) => ({ date, value: String(value) })) }) }) });
    })));

    const snapshot = chargerQuadrants({ regions: ["US"], maintenant: Date.UTC(2026, 8, 2), force: true });
    await vi.waitFor(() => expect(requetes).toHaveLength(3));
    const parent = macroSeriesStore.getState().demanderIndicateur("cpi-aa", { regions: ["US"], force: true, signal: new AbortController().signal });
    await vi.waitFor(() => expect(requetes).toHaveLength(4));
    let resolu = false;
    void snapshot.then(() => { resolu = true; });
    for (const requete of requetes.slice(0, 3)) requete.terminer();
    await vi.waitFor(() => expect(macroSeriesStore.getState().series["cpi-aa-us"]?.statut).toBe("loading"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resolu).toBe(false);

    requetes[3]!.terminer();
    await parent;
    const resultat = await snapshot;
    expect(resultat?.regions[0]?.points.at(-1)?.quadrant).toBe("croissance-accelere-inflation-decelere");
  });

  it("borne l'attente si la génération concurrente reste bloquée", async () => {
    const requetes: RequeteDifferee[] = [];
    vi.stubGlobal("fetch", vi.fn((raw: string) => new Promise((resolve) => {
      const id = new URL(raw, "http://localhost").searchParams.get("series_id")!;
      requetes.push({ id, terminer: () => resolve({ ok: true, status: 200, statusText: "OK", json: async () => ({ observations: observations(id).map(([date, value]) => ({ date, value: String(value) })) }) }) });
    })));
    const snapshot = chargerQuadrants({ regions: ["US"], maintenant: Date.UTC(2026, 8, 2), force: true, attenteConcurrenceMs: 10 });
    await vi.waitFor(() => expect(requetes).toHaveLength(3));
    const parent = macroSeriesStore.getState().demanderIndicateur("cpi-aa", { regions: ["US"], force: true, signal: new AbortController().signal });
    await vi.waitFor(() => expect(requetes).toHaveLength(4));
    for (const requete of requetes.slice(0, 3)) requete.terminer();
    const issue = await Promise.race([
      snapshot.then(() => "résolu", (cause: unknown) => cause instanceof Error ? cause.message : "erreur inconnue"),
      new Promise<string>((resolve) => setTimeout(() => resolve("attente sans borne"), 100)),
    ]);
    requetes[3]!.terminer();
    await parent;
    await snapshot.catch(() => undefined);
    expect(issue).toMatch(/Attente des séries macro concurrentes dépassée/);
  });

  it("l'annulation pendant l'attente concurrente rend null sans garder la requête active", async () => {
    const requetes: RequeteDifferee[] = [];
    vi.stubGlobal("fetch", vi.fn((raw: string) => new Promise((resolve) => {
      const id = new URL(raw, "http://localhost").searchParams.get("series_id")!;
      requetes.push({ id, terminer: () => resolve({ ok: true, status: 200, statusText: "OK", json: async () => ({ observations: observations(id).map(([date, value]) => ({ date, value: String(value) })) }) }) });
    })));
    const ctrl = new AbortController();
    const snapshot = chargerQuadrants({ regions: ["US"], maintenant: Date.UTC(2026, 8, 2), signal: ctrl.signal, force: true });
    await vi.waitFor(() => expect(requetes).toHaveLength(3));
    const parent = macroSeriesStore.getState().demanderIndicateur("cpi-aa", { regions: ["US"], force: true, signal: new AbortController().signal });
    await vi.waitFor(() => expect(requetes).toHaveLength(4));
    for (const requete of requetes.slice(0, 3)) requete.terminer();
    await vi.waitFor(() => expect(macroSeriesStore.getState().series["cpi-aa-us"]?.statut).toBe("loading"));
    ctrl.abort();
    expect(await snapshot).toBeNull();
    requetes[3]!.terminer();
    await parent;
  });
});
