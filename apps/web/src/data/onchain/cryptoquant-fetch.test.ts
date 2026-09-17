import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArchiveCq, LigneTaker, SerieCq } from "./cryptoquant";

// Daemon et store de clé pilotés par le test.
const { detecter, kvPutMock, cle } = vi.hoisted(() => ({
  detecter: vi.fn(async (_e?: string): Promise<boolean> => false),
  kvPutMock: vi.fn(async (_ns: string, _cle: string, _v: unknown): Promise<number | null> => 1),
  cle: { valeur: null as string | null, version: 0 },
}));
vi.mock("../daemon", () => ({ detectDaemon: detecter, urlDaemon: (c: string) => `http://d${c}`, kvPut: kvPutMock }));
// Vrai store (`RAISON_CLE_CRYPTOQUANT` réel, ré-exporté par le client) ; clé et version pilotées.
vi.mock("../../store/cryptoquant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../store/cryptoquant")>()),
  getCryptoquantKey: () => cle.valeur,
  cryptoquantKeyStore: { getState: () => ({ hasKey: cle.valeur !== null, version: cle.version,
    setKey: (v: string) => { cle.valeur = v; cle.version++; }, clearKey: () => { cle.valeur = null; cle.version++; } }) },
}));

function stockage(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k),
    clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
const T0 = Date.UTC(2026, 8, 16, 12);
const J = (n: number): string => new Date(T0 + n * 86_400_000).toISOString().slice(0, 10);
const plage = (de: number, a: number): string[] => Array.from({ length: a - de + 1 }, (_, i) => J(de + i));
const L: LigneTaker = { n: 1, bv: 2, qv: 3, bbv: 4, qbv: 5, bsv: 6, qsv: 7, vwap: 8, br: 0.5, bsr: 1, bc: 9, sc: 10 };
const arch = (js: string[], majTs: number | null, vwap = 8, serie: SerieCq = "taker:spot:btc"): ArchiveCq =>
  ({ version: 1, serie, majTs, jours: Object.fromEntries(js.map((j) => [j, { ...L, vwap }])) });
const CLE_BTC = "axiom:onchain:cq:taker:spot:btc:v1";
const poser = (a: ArchiveCq) => localStorage.setItem(`axiom:onchain:cq:${a.serie}:v1`, JSON.stringify(a));
const relire = (s: SerieCq = "taker:spot:btc") => JSON.parse(localStorage.getItem(`axiom:onchain:cq:${s}:v1`) ?? "null") as ArchiveCq | null;
const kvOk = (valeur: unknown) => () => Response.json({ namespace: "onchain", cle: "x", valeur, majA: 1 });
type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;
const aucun: Route = () => { throw new Error("appel CryptoQuant inattendu"); };
/** `fetch` routé : URL commençant par `http://d/kv/` → KV simulé (404 par défaut), le reste → API simulée. */
function reseau(api: Route, kv: Route = () => Response.json({ erreur: "absent" }, { status: 404 })) {
  const f = vi.fn(async (u: RequestInfo | URL, init?: RequestInit) => (String(u).startsWith("http://d/kv/") ? kv(String(u), init) : api(String(u), init)));
  vi.stubGlobal("fetch", f);
  return f;
}
function reinitialiser(): void {
  vi.resetModules();
  vi.stubGlobal("localStorage", stockage());
  vi.stubGlobal("__CQ_CLE_ENV__", false);
  detecter.mockReset().mockResolvedValue(false);
  kvPutMock.mockReset().mockResolvedValue(1);
  cle.valeur = null;
  cle.version = 0;
}

describe("CryptoQuant : persistance locale ∪ KV (I1, I4)", () => {
  beforeEach(reinitialiser);
  afterEach(() => { vi.unstubAllGlobals(); vi.doUnmock("../../lib/deployment"); });

  it("emplacements figés : clé locale sous le préfixe exclu des sauvegardes (tâche 7), clé KV par série", async () => {
    const cq = await import("./cryptoquant");
    expect(cq.cleLocale("taker:spot:btc")).toBe("axiom:onchain:cq:taker:spot:btc:v1");
    expect(cq.cleLocale("taker:spot:btc")).toBe(CLE_BTC);
    expect(cq.cleKv("mineur:mara")).toBe("cq:mineur:mara:v1");
    const series = [...cq.SERIES_TAKER, ...cq.SERIES_MINEURS];
    expect(series.map(cq.cleLocale).filter((c) => !c.startsWith("axiom:onchain:cq:") || !c.endsWith(":v1"))).toEqual([]);
    expect(new Set(series.map(cq.cleKv)).size).toBe(13);
  });

  it("sans daemon : local seul, kv null ; Vercel : ni sonde ni KV", async () => {
    let cq = await import("./cryptoquant");
    poser(arch(plage(-3, -2), 10));
    const f = reseau(aucun);
    expect(await cq.lireArchiveCq("taker:spot:btc")).toMatchObject({ kv: "sans-daemon", persistance: { local: true, kv: null } });
    expect(detecter).toHaveBeenCalledWith("kv");
    vi.resetModules();
    vi.doMock("../../lib/deployment", () => ({ IS_VERCEL: true }));
    detecter.mockClear().mockResolvedValue(true);
    cq = await import("./cryptoquant");
    expect((await cq.lireArchiveCq("taker:spot:btc")).kv).toBe("sans-daemon");
    expect(detecter).not.toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
  });

  it("local vide + KV 400 j → 400 j servis et réécrits ; après fusion kvPut reçoit 401 j", async () => {
    const cq = await import("./cryptoquant");
    detecter.mockResolvedValue(true);
    const f = reseau(aucun, kvOk(arch(plage(-401, -2), 20)));
    const l = await cq.lireArchiveCq("taker:spot:btc");
    expect(f.mock.calls[0]?.[0]).toBe("http://d/kv/onchain/cq%3Ataker%3Aspot%3Abtc%3Av1");
    expect(l).toMatchObject({ kv: "presente", persistance: { local: true, kv: true } });
    expect([Object.keys(relire()?.jours ?? {}).length, relire()?.majTs]).toEqual([400, 20]);
    const fusion = cq.fusionner(l.archive, "taker:spot:btc", [{ jour: J(-1), ligne: L }], 99);
    expect(await cq.ecrireArchiveCq("taker:spot:btc", fusion, l.kv)).toEqual({ local: true, kv: true });
    const [ns, cleKv, valeur] = kvPutMock.mock.calls[0] ?? [];
    expect([ns, cleKv, Object.keys((valeur as ArchiveCq).jours).length]).toEqual(["onchain", "cq:taker:spot:btc:v1", 401]);
  });

  it.each([
    ["HTTP 500", () => new Response(null, { status: 500 })],
    ["réseau", () => { throw new TypeError("échec"); }],
  ] as const)("KV en erreur (%s) → kvPut jamais appelé, local écrit", async (_n, kv) => {
    const cq = await import("./cryptoquant");
    detecter.mockResolvedValue(true);
    reseau(aucun, kv);
    const l = await cq.lireArchiveCq("taker:spot:btc");
    expect(l).toMatchObject({ archive: null, kv: "erreur", persistance: { kv: false } });
    expect(await cq.ecrireArchiveCq("taker:spot:btc", arch([J(-1)], 5), l.kv)).toEqual({ local: true, kv: false });
    expect(kvPutMock).not.toHaveBeenCalled();
    expect(relire()?.majTs).toBe(5);
  });

  it("conflit même jour → copie au majTs le plus grand, réécriture locale si enrichie", async () => {
    const cq = await import("./cryptoquant");
    detecter.mockResolvedValue(true);
    poser(arch([J(-3), J(-2)], 300, 1));
    reseau(aucun, kvOk(arch([J(-2)], 200, 2)));
    expect((await cq.lireArchiveCq("taker:spot:btc")).archive?.jours[J(-2)]).toMatchObject({ vwap: 1 });
    reseau(aucun, kvOk(arch([J(-2)], 400, 2)));
    expect((await cq.lireArchiveCq("taker:spot:btc")).archive?.jours[J(-2)]).toMatchObject({ vwap: 2 });
    expect([Object.keys(relire()?.jours ?? {}), relire()?.majTs]).toEqual([[J(-3), J(-2)], 400]);
  });

  it("version inconnue (locale ou KV) : servie vide, jamais réécrite ; JSON illisible : signalé puis remplacé", async () => {
    const cq = await import("./cryptoquant");
    detecter.mockResolvedValue(true);
    const futur = JSON.stringify({ version: 2 });
    localStorage.setItem(CLE_BTC, futur);
    const setItem = vi.spyOn(localStorage, "setItem");
    reseau(aucun, kvOk(arch(plage(-5, -2), 1)));
    expect(await cq.lireArchiveCq("taker:spot:btc")).toMatchObject({ archive: null, versionInconnue: true });
    localStorage.removeItem(CLE_BTC);
    reseau(aucun, kvOk({ version: 3 }));
    expect(await cq.lireArchiveCq("taker:spot:btc")).toMatchObject({ archive: null, versionInconnue: true });
    expect(setItem).not.toHaveBeenCalled();
    localStorage.setItem(CLE_BTC, "{pas du json");
    reseau(aucun);
    const l = await cq.lireArchiveCq("taker:spot:btc");
    expect(l).toMatchObject({ archive: null, localIllisible: true, kv: "absente" });
    await cq.ecrireArchiveCq("taker:spot:btc", arch([J(-1)], 7), l.kv);
    expect(relire()?.majTs).toBe(7);
  });

  it("stockage plein → local false ; > 900 000 caractères ou kvPut null → kv false", async () => {
    const cq = await import("./cryptoquant");
    const geante = arch(Array.from({ length: 12_000 }, (_, i) => new Date(Date.UTC(1990, 0, 1) + i * 86_400_000).toISOString().slice(0, 10)), 7);
    expect(JSON.stringify(geante).length).toBeGreaterThan(900_000);
    expect(await cq.ecrireArchiveCq("taker:spot:btc", geante, "presente")).toEqual({ local: true, kv: false });
    expect(kvPutMock).not.toHaveBeenCalled();
    kvPutMock.mockResolvedValue(null);
    expect(await cq.ecrireArchiveCq("taker:spot:btc", arch([J(-1)], 7), "absente")).toEqual({ local: true, kv: false });
    localStorage.setItem = () => { throw new DOMException("quota", "QuotaExceededError"); };
    kvPutMock.mockResolvedValue(1);
    expect(await cq.ecrireArchiveCq("taker:spot:btc", arch([J(-1)], 7), "absente")).toEqual({ local: false, kv: true });
  });
});

// --- File 10 req / 60 s (tâche 12) ---
const vider = async () => { for (let i = 0; i < 200; i++) await Promise.resolve(); };
const avancer = async (ms: number) => { await vi.advanceTimersByTimeAsync(ms); await vider(); };

describe("CryptoQuant : file 10 req / 60 s (I6, I7)", () => {
  beforeEach(() => { reinitialiser(); vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }); vi.setSystemTime(T0); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("13 demandes : 10 créneaux immédiats, 3 après 60 s ; quota publié ; abonnés notifiés", async () => {
    const cq = await import("./cryptoquant");
    const { healthStore } = await import("../../store/health");
    const notifie = vi.fn();
    cq.abonnerFileCq(notifie);
    let acquis = 0;
    const s = new AbortController().signal;
    const toutes = Array.from({ length: 13 }, () => cq.acquerirCreneauCq(s).then((ok) => { acquis += ok ? 1 : 0; return ok; }));
    await vider();
    expect([acquis, cq.etatFileCq()]).toEqual([10, { enAttente: 3, repriseTs: null }]);
    expect(healthStore.getState().sources.cryptoquant?.quota).toEqual({ utilise: 10, limite: 10, fenetre: "1min" });
    await avancer(59_999);
    expect(acquis).toBe(10);
    await avancer(1);
    expect(await Promise.all(toutes)).toEqual(Array.from({ length: 13 }, () => true));
    expect(healthStore.getState().sources.cryptoquant?.quota?.utilise).toBe(3);
    expect(notifie).toHaveBeenCalled();
  });

  it("x-ratelimit-remaining 0 + reset 42 : la suivante part après 42 s", async () => {
    const cq = await import("./cryptoquant");
    const s = new AbortController().signal;
    await cq.acquerirCreneauCq(s);
    cq.noterReponseCq(new Response(null, { headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "42" } }));
    let ok = false;
    void cq.acquerirCreneauCq(s).then((r) => { ok = r; });
    await avancer(41_999);
    expect(ok).toBe(false);
    await avancer(1);
    expect(ok).toBe(true);
  });

  it("etatFileCq : enAttente = demandes sans créneau ; repriseTs = reprise la plus tardive (429 ou remaining 0)", async () => {
    const cq = await import("./cryptoquant");
    const notifie = vi.fn();
    cq.abonnerFileCq(notifie);
    const s = new AbortController().signal;
    expect(await cq.acquerirCreneauCq(s)).toBe(true);
    // Créneau obtenu = requête en vol : elle ne compte plus.
    expect(cq.etatFileCq()).toEqual({ enAttente: 0, repriseTs: null });
    notifie.mockClear();
    cq.noterReponseCq(new Response(null, { headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "42" } }));
    expect([cq.etatFileCq(), notifie.mock.calls.length > 0]).toEqual([{ enAttente: 0, repriseTs: T0 + 42_000 }, true]);
    cq.noterReponseCq(new Response(null, { status: 429, headers: { "x-ratelimit-reset": "5" } }));
    expect(cq.etatFileCq().repriseTs).toBe(T0 + 42_000);
    cq.noterReponseCq(new Response(null, { status: 429, headers: { "x-ratelimit-reset": "100" } }));
    expect(cq.etatFileCq().repriseTs).toBe(T0 + 100_000);
    let ok = false;
    void cq.acquerirCreneauCq(s).then((r) => { ok = r; });
    await vider();
    expect([ok, cq.etatFileCq()]).toEqual([false, { enAttente: 1, repriseTs: T0 + 100_000 }]);
    notifie.mockClear();
    await avancer(100_000);
    expect([ok, cq.etatFileCq()]).toEqual([true, { enAttente: 0, repriseTs: null }]);
    expect(notifie).toHaveBeenCalled();
  });

  it("429 : demande en file conservée puis reprise ; reset absurde 1e9 → 15 min ; bornes et repli 60 s", async () => {
    const cq = await import("./cryptoquant");
    const s = new AbortController().signal;
    cq.noterReponseCq(new Response(null, { status: 429, headers: { "x-ratelimit-reset": "1000000000" } }));
    expect(cq.etatFileCq()).toEqual({ enAttente: 0, repriseTs: T0 + 900_000 });
    let ok = false;
    void cq.acquerirCreneauCq(s).then((r) => { ok = r; });
    await avancer(899_999);
    expect([ok, cq.etatFileCq().enAttente]).toEqual([false, 1]);
    await avancer(1);
    expect([ok, cq.etatFileCq()]).toEqual([true, { enAttente: 0, repriseTs: null }]);
    for (const [entetes, delai] of [[{}, 60_000], [{ "retry-after": "5" }, 5_000], [{ "x-ratelimit-reset": "0" }, 1_000]] as const) {
      cq.noterReponseCq(new Response(null, { status: 429, headers: entetes }));
      expect(cq.etatFileCq().repriseTs).toBe(Date.now() + delai);
    }
  });

  it("annulation pendant l'attente : false, aucun créneau consommé", async () => {
    const cq = await import("./cryptoquant");
    const { healthStore } = await import("../../store/health");
    const libre = new AbortController().signal;
    for (let i = 0; i < 10; i++) await cq.acquerirCreneauCq(libre);
    const ctrl = new AbortController();
    const attente = cq.acquerirCreneauCq(ctrl.signal);
    ctrl.abort();
    expect([await attente, cq.etatFileCq().enAttente]).toEqual([false, 0]);
    await avancer(60_000);
    await cq.acquerirCreneauCq(libre);
    expect(healthStore.getState().sources.cryptoquant?.quota?.utilise).toBe(1);
  });
});
