/**
 * Chemin « daemon présent » des instantanés d'options (surfaceConstante, deltaOiStrikes) : le KV
 * du daemon est simulé ; aucun appel réseau.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OptionPoint } from "./deribit";

const kv = new Map<string, unknown>();
const kvPut = vi.fn(async (ns: string, cle: string, valeur: unknown) => { kv.set(`${ns}/${cle}`, JSON.parse(JSON.stringify(valeur))); return 1; });
const kvDelete = vi.fn(async (ns: string, cle: string) => kv.delete(`${ns}/${cle}`));

vi.mock("./daemon", () => ({
  daemonPret: () => true,
  detectDaemon: async () => true,
  kvGet: async (ns: string, cle: string) => kv.get(`${ns}/${cle}`) ?? null,
  kvPut: (ns: string, cle: string, valeur: unknown) => kvPut(ns, cle, valeur),
  kvDelete: (ns: string, cle: string) => kvDelete(ns, cle),
  kvSnapshot: async (ns: string) => {
    const entrees: Record<string, { valeur: unknown; majA: number }> = {};
    for (const [k, valeur] of kv) if (k.startsWith(`${ns}/`)) entrees[k.slice(ns.length + 1)] = { valeur, majA: 1 };
    return entrees;
  },
}));

const { capturerInstantaneOi, lireInstantaneOi, construireInstantaneOi, cleLocaleOi, _viderCapturesOi } = await import("./deltaOiStrikes");
const { capturerSurfaceDuJour, lireArchiveSurface, _viderCapturesSurface, cleLocaleSurface } = await import("./surfaceConstante");

const JOUR = 86_400_000;
const SPOT = 100_000;
const T = Date.parse("2026-11-07T09:00:00Z");

function opt(expiryMs: number, strike: number, type: "call" | "put", openInterest: number, markIv = 50): OptionPoint {
  return { instrument: `${expiryMs}-${strike}-${type}`, expiryMs, strike, type, markIv, openInterest, underlying: SPOT, indexPrice: SPOT, interestRate: 0, volume24h: 0, markPrice: 0.01 };
}

function echeancePlate(jours: number, iv: number): OptionPoint[] {
  const out: OptionPoint[] = [];
  for (let m = 0.5; m <= 1.6001; m += 0.025) {
    const k = Math.round(SPOT * m);
    out.push(opt(T + jours * JOUR, k, k < SPOT ? "put" : "call", 500, iv));
  }
  return out;
}

function stockage(): Storage {
  const valeurs = new Map<string, string>();
  return {
    getItem: (k) => valeurs.get(k) ?? null, setItem: (k, v) => void valeurs.set(k, v),
    removeItem: (k) => void valeurs.delete(k), clear: () => valeurs.clear(), key: (i) => [...valeurs.keys()][i] ?? null,
    get length() { return valeurs.size; },
  };
}

beforeEach(() => {
  kv.clear();
  kvPut.mockClear();
  kvDelete.mockClear();
  vi.stubGlobal("localStorage", stockage());
  _viderCapturesOi();
  _viderCapturesSurface();
});
afterEach(() => vi.unstubAllGlobals());

describe("ΔOI — instantanés doublés dans le KV", () => {
  it("écrit l'instantané dans le KV et élague le KV au-delà de J-7", async () => {
    kv.set("oi-strikes/BTC:2026-10-20", { v: 1 });
    kv.set("oi-strikes/ETH:2026-10-20", { v: 1 });
    kv.set("oi-strikes/BTC:2026-10-31", { v: 1 });
    expect(await capturerInstantaneOi("BTC", [opt(T + 7 * JOUR, 100_000, "call", 5)], T)).toBe(true);
    expect(kv.has("oi-strikes/BTC:2026-11-07")).toBe(true);
    expect(kv.has("oi-strikes/BTC:2026-10-20")).toBe(false);
    expect(kv.has("oi-strikes/BTC:2026-10-31")).toBe(true);
    expect(kv.has("oi-strikes/ETH:2026-10-20")).toBe(true);
  });

  it("un instantané du jour déjà présent dans le KV (autre navigateur) est recopié, jamais remplacé", async () => {
    const premier = construireInstantaneOi([opt(T + 7 * JOUR, 100_000, "call", 5)], Date.parse("2026-11-07T08:10:00Z"));
    kv.set("oi-strikes/BTC:2026-11-07", premier);
    expect(await capturerInstantaneOi("BTC", [opt(T + 7 * JOUR, 100_000, "call", 999)], T)).toBe(false);
    expect(kvPut).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(cleLocaleOi("BTC", "2026-11-07"))!)).toEqual(premier);
  });

  it("lecture : le KV prime sur le localStorage (patron TERM)", async () => {
    const local = construireInstantaneOi([opt(T + 7 * JOUR, 100_000, "call", 1)], T - JOUR);
    const distant = construireInstantaneOi([opt(T + 7 * JOUR, 100_000, "call", 2)], T - JOUR + 60_000);
    localStorage.setItem(cleLocaleOi("BTC", "2026-11-06"), JSON.stringify(local));
    kv.set("oi-strikes/BTC:2026-11-06", distant);
    expect(await lireInstantaneOi("BTC", "2026-11-06")).toEqual(distant);
  });
});

describe("surface — archive localStorage ∪ KV", () => {
  const chain = [5, 10, 25, 35, 80, 100].flatMap((j) => echeancePlate(j, 50));

  it("la capture écrit l'union dans les deux stockages ; la lecture fusionne", async () => {
    const pointDistant = { j: "2026-11-05", t: Date.parse("2026-11-05T08:20:00Z"), v: Array.from({ length: 15 }, () => 1) };
    kv.set("surface-options/BTC:v1", { v: 1, points: [pointDistant] });
    const archive = await capturerSurfaceDuJour("BTC", chain, SPOT, T);
    expect(archive?.points.map((p) => p.j)).toEqual(["2026-11-05", "2026-11-07"]);
    expect((kv.get("surface-options/BTC:v1") as { points: unknown[] }).points).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem(cleLocaleSurface("BTC"))!).points).toHaveLength(2);
    const lue = await lireArchiveSurface("BTC");
    expect(lue.daemon).toBe(true);
    expect(lue.archive.points).toHaveLength(2);
  });

  it("le premier instantané du jour (le plus ancien) gagne entre KV et navigateur", async () => {
    const tot = { j: "2026-11-07", t: Date.parse("2026-11-07T08:06:00Z"), v: Array.from({ length: 15 }, () => 7) };
    kv.set("surface-options/BTC:v1", { v: 1, points: [tot] });
    const archive = await capturerSurfaceDuJour("BTC", chain, SPOT, T);
    expect(archive?.points).toEqual([tot]);
  });
});
