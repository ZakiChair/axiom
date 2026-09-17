import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArchiveCq, ChargementCq, LigneTaker, SerieCq } from "./cryptoquant";

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
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.doUnmock("../../lib/deployment"); });

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

  it("jours ≥ aujourd'hui UTC (local ou KV) ignorés à la lecture, archive stockée non réécrite", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const cq = await import("./cryptoquant");
    const stockee = arch([J(-2), J(0), J(1)], 10);
    poser(stockee);
    const setItem = vi.spyOn(localStorage, "setItem");
    reseau(aucun);
    expect(Object.keys((await cq.lireArchiveCq("taker:spot:btc")).archive?.jours ?? {})).toEqual([J(-2)]);
    // Jour non clos seul en KV : ni servi, ni compté comme un enrichissement.
    detecter.mockResolvedValue(true);
    reseau(aucun, kvOk(arch([J(-2), J(0)], 5)));
    expect(Object.keys((await cq.lireArchiveCq("taker:spot:btc")).archive?.jours ?? {})).toEqual([J(-2)]);
    // Série au J-1 archivé : le « dernier jour » affiché n'est jamais un jour non clos.
    detecter.mockResolvedValue(false);
    poser(arch([J(-1), J(0), J(1)], 10));
    setItem.mockClear();
    expect(await cq.chargerSerieCq("taker:spot:btc")).toMatchObject({ statut: "pret", appel: false, diagnostic: { dernier: J(-1), hierPresent: true } });
    expect([setItem.mock.calls.length, kvPutMock.mock.calls.length, Object.keys(relire()?.jours ?? {})]).toEqual([0, 0, [J(-1), J(0), J(1)]]);
  });

  it("écriture KV sans réponse : bornée à 5 s comme la lecture, kv false, série rendue", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(T0);
    cle.valeur = "perso";
    const cq = await import("./cryptoquant");
    detecter.mockResolvedValue(true);
    kvPutMock.mockReturnValue(new Promise<number | null>(() => {}));
    reseau(api200);
    let r: ChargementCq | undefined;
    void cq.chargerSerieCq("taker:spot:btc").then((x) => { r = x; });
    await tourner();
    await avancer(4_999);
    expect([r, kvPutMock.mock.calls.length]).toEqual([undefined, 1]);
    await avancer(1);
    expect(r).toMatchObject({ statut: "pret", appel: true, persistance: { local: true, kv: false } });
    expect(Object.keys(relire()?.jours ?? {})).toHaveLength(30);
  });

  it("KV joignable mais vide : amorcée par l'union locale non vide, kv reflète l'écriture réelle", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const cq = await import("./cryptoquant");
    detecter.mockResolvedValue(true);
    const f = reseau(aucun);
    // Union vide : rien à amorcer.
    expect((await cq.lireArchiveCq("taker:spot:btc")).persistance).toEqual({ local: true, kv: true });
    expect(kvPutMock).not.toHaveBeenCalled();
    // Archive locale de 200 j contenant J-1 (collectée sans daemon) : un seul kvPut de l'union.
    poser(arch(plage(-200, -1), 10));
    expect(await cq.chargerSerieCq("taker:spot:btc")).toMatchObject({ statut: "pret", appel: false, persistance: { local: true, kv: true } });
    const [ns, cleKv, valeur] = kvPutMock.mock.calls[0] ?? [];
    expect([kvPutMock.mock.calls.length, ns, cleKv, Object.keys((valeur as ArchiveCq).jours).length]).toEqual([1, "onchain", "cq:taker:spot:btc:v1", 200]);
    expect(appels(f)).toHaveLength(0);
    // Écriture refusée par le daemon : signalée, jamais « copie durable ».
    kvPutMock.mockClear().mockResolvedValue(null);
    expect(await cq.chargerSerieCq("taker:spot:btc")).toMatchObject({ statut: "pret", persistance: { local: true, kv: false } });
    expect(kvPutMock).toHaveBeenCalledTimes(1);
  });
});

// --- File 10 req / 60 s (tâche 12) ---
const vider = async () => { for (let i = 0; i < 200; i++) await Promise.resolve(); };
/** Tours de boucle réels (`setImmediate` n'est jamais simulé ici) : laisse les corps `Response` se lire. */
const tourner = async () => { for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r)); };
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
    // Segment crédits publié avec le quota minute (§13) : rien consommé ici, donc 0.
    expect(healthStore.getState().sources.cryptoquant?.quota).toEqual({ utilise: 10, limite: 10, fenetre: "1min", credits: { utilise: 0, limite: 10_000, jours: 31 } });
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
      // Reprise échue avant le 429 suivant : sinon la plus tardive des deux est gardée.
      await avancer(delai);
    }
  });

  it("429 long puis 429 court : la reprise ne recule pas", async () => {
    const cq = await import("./cryptoquant");
    cq.noterReponseCq(new Response(null, { status: 429, headers: { "x-ratelimit-reset": "600" } }));
    cq.noterReponseCq(new Response(null, { status: 429, headers: { "retry-after": "5" } }));
    expect(cq.etatFileCq().repriseTs).toBe(T0 + 600_000);
    let ok = false;
    void cq.acquerirCreneauCq(new AbortController().signal).then((r) => { ok = r; });
    await avancer(599_999);
    expect(ok).toBe(false);
    await avancer(1);
    expect(ok).toBe(true);
  });

  it.each([
    ["epoch en millisecondes", String(T0 + 30_000)],
    ["epoch en secondes", String(T0 / 1000 + 30)],
    ["secondes relatives", "30"],
  ])("x-ratelimit-reset en %s → reprise dans 30 s (429 et remaining 0)", async (_n, reset) => {
    const cq = await import("./cryptoquant");
    cq.noterReponseCq(new Response(null, { headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset } }));
    expect(cq.etatFileCq().repriseTs).toBe(T0 + 30_000);
    cq.noterReponseCq(new Response(null, { status: 429, headers: { "x-ratelimit-reset": reset } }));
    expect(cq.etatFileCq().repriseTs).toBe(T0 + 30_000);
  });

  it("x-ratelimit-reset en epoch : bornes conservées (passé → 1 s, lointain → 15 min)", async () => {
    const cq = await import("./cryptoquant");
    cq.noterReponseCq(new Response(null, { status: 429, headers: { "x-ratelimit-reset": String(T0 / 1000 - 3600) } }));
    expect(cq.etatFileCq().repriseTs).toBe(T0 + 1_000);
    await avancer(1_000);
    cq.noterReponseCq(new Response(null, { status: 429, headers: { "x-ratelimit-reset": String(T0 + 86_400_000) } }));
    expect(cq.etatFileCq().repriseTs).toBe(T0 + 1_000 + 900_000);
  });

  it("quota DATA : redescend quand les créneaux sortent de la fenêtre de 60 s, minuterie unique puis aucune", async () => {
    const cq = await import("./cryptoquant");
    const { healthStore } = await import("../../store/health");
    const utilise = () => healthStore.getState().sources.cryptoquant?.quota?.utilise;
    const s = new AbortController().signal;
    await cq.acquerirCreneauCq(s);
    await avancer(10_000);
    await cq.acquerirCreneauCq(s);
    // La republication précédente est annulée : une seule minuterie en attente.
    expect([utilise(), vi.getTimerCount()]).toEqual([2, 1]);
    await avancer(49_999);
    expect(utilise()).toBe(2);
    await avancer(1);
    expect([utilise(), vi.getTimerCount()]).toEqual([1, 1]);
    await avancer(9_999);
    expect(utilise()).toBe(1);
    await avancer(1);
    // Fenêtre vide : quota publié à 0 et plus aucune minuterie.
    expect([utilise(), vi.getTimerCount()]).toEqual([0, 0]);
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

// --- Orchestrateur (tâche 13) ---
const brute = (jour: string) => ({ datetime: `${jour} 00:00:00`, trade_count: 1, base_volume: 2, quote_volume: 3, base_buy_volume: 4,
  quote_buy_volume: 5, base_sell_volume: 6, quote_sell_volume: 7, vwap: 8, buy_ratio: 0.5, buy_sell_ratio: 1, buy_count: 9, sell_count: 10 });
const api200 = () => Response.json({ status: { code: 200 }, result: { data: plage(-30, -1).reverse().map(brute) } });
/** Même 200 que `api200`, avec les en-têtes de réponse voulus (`x-credit-cost`). */
const api200Entetes = (headers: Record<string, string>) => () =>
  Response.json({ status: { code: 200 }, result: { data: plage(-30, -1).reverse().map(brute) } }, { headers });
const statut = (status: number, message = "", headers: Record<string, string> = {}) => Response.json({ status: { code: status, message } }, { status, headers });
const appels = (f: ReturnType<typeof reseau>) => f.mock.calls.filter(([u]) => String(u).startsWith("/cqapi/"));
const DOUZE_H = 12 * 3600_000;
const SECRET = "CLE-TEST-SECRETE";
/** Horloge réelle pour `setTimeout` (seul `Date` est simulé ici) : laisse avancer les promesses jusqu'à la condition. */
const jusqua = async (condition: () => boolean) => {
  for (let i = 0; i < 100 && !condition(); i++) await new Promise((r) => setTimeout(r, 0));
};

describe("CryptoQuant : chargerSerieCq (I5, I7, I9, I10)", () => {
  beforeEach(() => { reinitialiser(); cle.valeur = "perso"; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(T0); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.doUnmock("../../lib/deployment"); });

  it("C5 — J-1 archivé ou appel < 12 h → 0 appel ; ≥ 12 h → 1 appel exact, fusion écrite, santé polling", async () => {
    const cq = await import("./cryptoquant");
    const { healthStore } = await import("../../store/health");
    const f = reseau(api200);
    poser(arch(plage(-30, -1), 0));
    expect(await cq.chargerSerieCq("taker:spot:btc")).toMatchObject({ statut: "pret", raison: null, appel: false, diagnostic: { hierPresent: true } });
    // now − 11 h 59 (1 ms sous le seuil) : reprise active, 0 appel.
    poser(arch(plage(-40, -2), T0 - DOUZE_H + 1));
    expect(await cq.chargerSerieCq("taker:spot:btc")).toMatchObject({ statut: "pret", appel: false });
    expect(appels(f)).toHaveLength(0);
    // now − 12 h pile : reprise échue, 1 appel.
    poser(arch(plage(-40, -2), T0 - DOUZE_H));
    const r = await cq.chargerSerieCq("taker:spot:btc");
    expect(appels(f)).toEqual([["/cqapi/v2/market/cq/spot/trade?symbol=btc_all&window=day&limit=30",
      expect.objectContaining({ cache: "no-store", redirect: "error", headers: { accept: "application/json", Authorization: "Bearer perso" }, signal: expect.any(AbortSignal) })]]);
    expect(r).toMatchObject({ statut: "pret", appel: true, persistance: { local: true, kv: null }, diagnostic: { debut: J(-40), dernier: J(-1), manquantsFenetre: [] } });
    expect([relire()?.majTs, Object.keys(relire()?.jours ?? {}).length]).toEqual([T0, 40]);
    expect(healthStore.getState().sources.cryptoquant).toMatchObject({ etat: "polling", quota: { utilise: 1, limite: 10, fenetre: "1min" } });
  });

  it("majTs futur (horloge en avance, corrigée depuis) : traité comme expiré → 1 appel, majTs réécrit à l'heure courante", async () => {
    const cq = await import("./cryptoquant");
    const f = reseau(api200);
    poser(arch(plage(-30, -2), T0 + 40 * 86_400_000));
    const r = await cq.chargerSerieCq("taker:spot:btc");
    expect(appels(f)).toHaveLength(1);
    expect(r).toMatchObject({ statut: "pret", appel: true });
    expect(relire()?.majTs).toBe(T0);
  });

  it.each([
    ["réseau", () => { throw new TypeError("échec"); }],
    ["HTTP 500", () => new Response("panne", { status: 500 })],
    ["HTTP 400", () => statut(400, "Out of allowed request range")],
  ] as const)("échec %s : erreur, majTs inchangé, archive servie, santé en erreur", async (_n, api) => {
    const cq = await import("./cryptoquant");
    const { healthStore } = await import("../../store/health");
    const avant = arch(plage(-30, -2), T0 - DOUZE_H);
    poser(avant);
    reseau(api);
    const r = await cq.chargerSerieCq("taker:spot:btc");
    expect(r).toMatchObject({ statut: "erreur", raison: "CryptoQuant injoignable ; archive affichée.", appel: true });
    expect([r.archive, relire(), healthStore.getState().sources.cryptoquant?.etat]).toEqual([avant, avant, "error"]);
  });

  it("429 : quota, aucune écriture, série suivante en quota sans appel", async () => {
    const cq = await import("./cryptoquant");
    poser(arch(plage(-30, -2), null));
    const setItem = vi.spyOn(localStorage, "setItem");
    const f = reseau(() => statut(429, "", { "x-ratelimit-reset": "30" }));
    expect(await cq.chargerSerieCq("taker:spot:btc")).toMatchObject({ statut: "quota", raison: "Quota CryptoQuant atteint (429) ; nouvel essai dans 30 s.", appel: true });
    expect(await cq.chargerSerieCq("mineur:riot")).toMatchObject({ statut: "quota", appel: false });
    expect([appels(f).length, setItem.mock.calls.length, kvPutMock.mock.calls.length]).toEqual([1, 0, 0]);
  });

  it("403 taker mémorisé par famille, effacé par setKey ; 401 → clé refusée, mémorisé jusqu'à la rotation", async () => {
    const cq = await import("./cryptoquant");
    const { cryptoquantKeyStore } = await import("../../store/cryptoquant");
    let f = reseau((u) => (u.includes("/market/") ? statut(403, "Professional plan and above") : Response.json({ status: { code: 200 }, result: { data: [{ date: J(-1), total_rewards: 1 }] } })));
    expect(await cq.chargerSerieCq("taker:spot:btc")).toMatchObject({ statut: "offre", raison: "Offre CryptoQuant insuffisante : Professional plan and above" });
    expect(await cq.chargerSerieCq("taker:swap:eth")).toMatchObject({ statut: "offre", appel: false });
    expect(await cq.chargerSerieCq("mineur:mara")).toMatchObject({ statut: "pret", appel: true });
    cryptoquantKeyStore.getState().setKey("nouvelle");
    expect(await cq.chargerSerieCq("taker:swap:eth")).toMatchObject({ statut: "offre", appel: true });
    expect(appels(f)).toHaveLength(3);
    f = reseau(() => statut(401, "Unauthorized"));
    expect(await cq.chargerSerieCq("mineur:riot")).toMatchObject({ statut: "cle-requise", raison: "Clé CryptoQuant refusée (Réglages ⚙).", appel: true });
    expect(await cq.chargerSerieCq("mineur:wulf")).toMatchObject({ statut: "cle-requise", appel: false });
    cryptoquantKeyStore.getState().clearKey();
    expect(await cq.chargerSerieCq("mineur:wulf")).toMatchObject({ statut: "cle-requise", raison: cq.RAISON_CLE_CRYPTOQUANT, appel: false });
    cryptoquantKeyStore.getState().setKey("autre");
    await cq.chargerSerieCq("mineur:wulf");
    expect(appels(f)).toHaveLength(2);
  });

  it("coalescence : 2 consommateurs = 1 appel, aucun « en attente » ; annulation avant le créneau : 0 appel, 0 créneau", async () => {
    const cq = await import("./cryptoquant");
    const { healthStore } = await import("../../store/health");
    let repondre = (_r: Response) => {};
    let f = reseau(() => new Promise<Response>((r) => { repondre = r; }));
    const deux = Promise.all([cq.chargerSerieCq("taker:spot:btc"), cq.chargerSerieCq("taker:spot:btc")]);
    await jusqua(() => appels(f).length > 0);
    // Requête en vol + consommateur coalescé : ni l'une ni l'autre n'attend un créneau.
    expect([appels(f).length, cq.etatFileCq()]).toEqual([1, { enAttente: 0, repriseTs: null }]);
    repondre(api200());
    const [a, b] = await deux;
    expect([appels(f).length, a.statut, b.statut]).toEqual([1, "pret", "pret"]);
    healthStore.getState().retirer("cryptoquant");
    let liberer = (_v: boolean) => {};
    detecter.mockReturnValueOnce(new Promise<boolean>((r) => { liberer = r; }));
    f = reseau(api200);
    const ctrl = new AbortController();
    const annule = cq.chargerSerieCq("taker:spot:eth", ctrl.signal);
    ctrl.abort();
    expect(await annule).toMatchObject({ statut: "erreur", raison: "Chargement CryptoQuant annulé.", appel: false });
    liberer(false);
    await new Promise((r) => setTimeout(r, 0));
    expect([appels(f).length, healthStore.getState().sources.cryptoquant]).toEqual([0, undefined]);
  });

  it("KV 400 j : kvPut reçoit 401 j après l'appel ; version inconnue locale ou KV : erreur, 0 appel, rien réécrit", async () => {
    let cq = await import("./cryptoquant");
    detecter.mockResolvedValue(true);
    reseau(api200, kvOk(arch(plage(-401, -2), T0 - DOUZE_H)));
    expect(await cq.chargerSerieCq("taker:spot:btc")).toMatchObject({ statut: "pret", persistance: { local: true, kv: true } });
    expect(Object.keys((kvPutMock.mock.calls[0]?.[2] as ArchiveCq).jours)).toHaveLength(401);
    vi.resetModules();
    kvPutMock.mockClear();
    vi.stubGlobal("localStorage", stockage());
    localStorage.setItem(CLE_BTC, JSON.stringify({ version: 2 }));
    const setItem = vi.spyOn(localStorage, "setItem");
    cq = await import("./cryptoquant");
    const f = reseau(api200);
    expect(await cq.chargerSerieCq("taker:spot:btc")).toMatchObject({ statut: "erreur", raison: cq.RAISON_VERSION_CRYPTOQUANT, archive: null, appel: false });
    expect([appels(f).length, setItem.mock.calls.length, kvPutMock.mock.calls.length]).toEqual([0, 0, 0]);
    // Version inconnue côté KV, archive locale saine : servie vide, rien réécrit ni en local ni en KV.
    vi.resetModules();
    vi.stubGlobal("localStorage", stockage());
    poser(arch(plage(-30, -2), null));
    const setItemKv = vi.spyOn(localStorage, "setItem");
    cq = await import("./cryptoquant");
    const g = reseau(api200, kvOk({ version: 3 }));
    expect(await cq.chargerSerieCq("taker:spot:btc")).toMatchObject({ statut: "erreur", raison: cq.RAISON_VERSION_CRYPTOQUANT, archive: null, appel: false });
    expect([appels(g).length, setItemKv.mock.calls.length, kvPutMock.mock.calls.length]).toEqual([0, 0, 0]);
    expect(relire()?.jours).toEqual(arch(plage(-30, -2), null).jours);
  });

  it("I9 — Vercel sans clé perso (drapeau env vrai) : 0 fetch, 0 créneau, aucun accès KV, archive servie", async () => {
    cle.valeur = null;
    vi.stubGlobal("__CQ_CLE_ENV__", true);
    vi.doMock("../../lib/deployment", () => ({ IS_VERCEL: true }));
    const cq = await import("./cryptoquant");
    const { healthStore } = await import("../../store/health");
    detecter.mockResolvedValue(true);
    poser(arch(plage(-30, -2), null));
    const f = reseau(aucun);
    const r = await cq.chargerSerieCq("taker:spot:btc");
    expect(r).toMatchObject({ statut: "cle-requise", raison: "Clé CryptoQuant personnelle requise (Réglages ⚙).", appel: false });
    expect([Object.keys(r.archive?.jours ?? {}).length, f.mock.calls.length, detecter.mock.calls.length]).toEqual([29, 0, 0]);
    expect(healthStore.getState().sources.cryptoquant).toBeUndefined();
  });

  it("I10 — local sans clé : 0 fetch sans drapeau ; drapeau vrai → fetch SANS Authorization", async () => {
    cle.valeur = null;
    let cq = await import("./cryptoquant");
    let f = reseau(aucun);
    expect(await cq.chargerSerieCq("taker:spot:btc")).toMatchObject({ statut: "cle-requise", archive: null });
    expect(f).not.toHaveBeenCalled();
    vi.resetModules();
    vi.stubGlobal("__CQ_CLE_ENV__", true);
    cq = await import("./cryptoquant");
    f = reseau(api200);
    expect((await cq.chargerSerieCq("taker:spot:btc")).statut).toBe("pret");
    expect(appels(f)[0]?.[1]?.headers).toEqual({ accept: "application/json" });
  });

  it("minuit franchi pendant l'attente du créneau : jour recalculé, la ligne devenue J-1 est gardée", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(Date.UTC(2026, 8, 16, 23, 59, 30));
    const cq = await import("./cryptoquant");
    const libre = new AbortController().signal;
    for (let i = 0; i < 10; i++) await cq.acquerirCreneauCq(libre);
    poser(arch(plage(-30, -2), null));
    // Réponse servie après minuit : elle publie la journée du 16, close depuis.
    const f = reseau(() => Response.json({ status: { code: 200 }, result: { data: plage(-30, 0).reverse().map(brute) } }));
    let r: ChargementCq | undefined;
    void cq.chargerSerieCq("taker:spot:btc").then((x) => { r = x; });
    await tourner();
    await avancer(59_999);
    expect([appels(f).length, r]).toEqual([0, undefined]);
    await avancer(1);
    await tourner();
    expect(appels(f)).toHaveLength(1);
    expect(r).toMatchObject({ statut: "pret", appel: true, diagnostic: { dernier: J(0), hierPresent: true, perime: false } });
    expect(Object.keys(relire()?.jours ?? {})).toEqual(plage(-30, 0));
  });

  it("clé personnelle hors ASCII visible (U+200B) : clé refusée avant tout créneau, 0 appel", async () => {
    cle.valeur = "abc\u200Bdef";
    const cq = await import("./cryptoquant");
    const { healthStore } = await import("../../store/health");
    poser(arch(plage(-30, -2), null));
    const f = reseau(aucun);
    const r = await cq.chargerSerieCq("taker:spot:btc");
    expect(r).toMatchObject({ statut: "cle-requise", raison: "Clé CryptoQuant refusée (Réglages ⚙).", appel: false });
    expect(Object.keys(r.archive?.jours ?? {})).toHaveLength(29);
    expect([f.mock.calls.length, cq.etatFileCq(), healthStore.getState().sources.cryptoquant]).toEqual([0, { enAttente: 0, repriseTs: null }, undefined]);
    // Clé corrigée (nouvelle version) : l'appel part.
    const { cryptoquantKeyStore } = await import("../../store/cryptoquant");
    cryptoquantKeyStore.getState().setKey("perso");
    reseau(api200);
    expect(await cq.chargerSerieCq("taker:spot:btc")).toMatchObject({ statut: "pret", appel: true });
  });
});

describe("CryptoQuant : la clé n'apparaît nulle part (I8)", () => {
  beforeEach(() => { reinitialiser(); cle.valeur = SECRET; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(T0); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("ni URL, ni raison, ni stockage, ni KV, ni console, ni santé", async () => {
    const cq = await import("./cryptoquant");
    const { healthStore } = await import("../../store/health");
    const consoles = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const setItem = vi.spyOn(localStorage, "setItem");
    detecter.mockResolvedValue(true);
    const f = reseau((u) => {
      if (u.includes("btc_all")) return api200();
      if (u.includes("eth_all")) return statut(403, `Invalid key ${SECRET}`);
      if (u.includes("mara")) return new Response(`erreur ${SECRET}`, { status: 500 });
      if (u.includes("riot")) throw new TypeError(`échec ${SECRET}`);
      return statut(429, SECRET, { "retry-after": "5" });
    });
    const res: Awaited<ReturnType<typeof cq.chargerSerieCq>>[] = [];
    for (const s of ["taker:spot:btc", "taker:spot:eth", "mineur:mara", "mineur:riot", "mineur:wulf"] as const) res.push(await cq.chargerSerieCq(s));
    expect(res.map((r) => r.statut)).toEqual(["pret", "offre", "erreur", "erreur", "quota"]);
    expect(appels(f)[0]?.[1]?.headers).toMatchObject({ Authorization: `Bearer ${SECRET}` });
    expect(kvPutMock).toHaveBeenCalled();
    const traces = [...f.mock.calls.map(([u]) => String(u)), ...res, ...setItem.mock.calls, ...kvPutMock.mock.calls,
      ...consoles.flatMap((s) => s.mock.calls), healthStore.getState().sources, cq.etatFileCq()].map((t) => JSON.stringify(t));
    expect(traces.filter((t) => t.includes(SECRET))).toEqual([]);
  });

  it("message 403 tronqué à 200 caractères : la coupure ne doit pas laisser passer un fragment de la clé", async () => {
    const cq = await import("./cryptoquant");
    const { healthStore } = await import("../../store/health");
    // La clé tombe exactement sur la coupure à 200 caractères : sans lire le message en entier
    // avant de tronquer, le test d'inclusion de la clé échoue et un fragment fuit dans la raison.
    const message = `${"x".repeat(190)} ${SECRET}`;
    const f = reseau(() => statut(403, message));
    const r = await cq.chargerSerieCq("taker:spot:btc");
    expect(r).toMatchObject({ statut: "offre", raison: "Offre CryptoQuant insuffisante pour cette série (403)." });
    // Même famille (taker), mémorisé en session par `refusOffre` : la raison observée ici est
    // bien celle gardée pour la famille, pas seulement celle du premier appel.
    expect(await cq.chargerSerieCq("taker:swap:eth")).toMatchObject({ statut: "offre", appel: false,
      raison: "Offre CryptoQuant insuffisante pour cette série (403)." });
    const fragment = SECRET.slice(0, 8);
    const traces = [...f.mock.calls.map(([u]) => String(u)), r, healthStore.getState().sources, cq.etatFileCq()].map((t) => JSON.stringify(t));
    expect(traces.filter((t) => t.includes(fragment))).toEqual([]);
  });

  it("clé .env (drapeau vrai, clé personnelle nulle) : message 403 amont jamais affiché ni mémorisé", async () => {
    cle.valeur = null;
    vi.stubGlobal("__CQ_CLE_ENV__", true);
    const cq = await import("./cryptoquant");
    const { healthStore } = await import("../../store/health");
    // Le client ignore la clé injectée par le proxy : il ne peut pas vérifier que le message ne la recopie pas.
    const marqueur = "MARQUEUR-ENV";
    const f = reseau(() => statut(403, `Invalid key ${marqueur}`));
    const res = [await cq.chargerSerieCq("taker:spot:btc"), await cq.chargerSerieCq("taker:swap:eth")];
    expect(res).toMatchObject([
      { statut: "offre", appel: true, raison: "Offre CryptoQuant insuffisante pour cette série (403)." },
      { statut: "offre", appel: false, raison: "Offre CryptoQuant insuffisante pour cette série (403)." },
    ]);
    expect([appels(f).length, appels(f)[0]?.[1]?.headers]).toEqual([1, { accept: "application/json" }]);
    const traces = [...res, cq.etatFileCq(), healthStore.getState().sources].map((t) => JSON.stringify(t));
    expect(traces.filter((t) => t.includes(marqueur))).toEqual([]);
  });
});

// --- Budget de crédits (§13, tâche 2) ---
const CLE_CREDITS = "axiom:cryptoquant:credits:v1";
const credits = () => JSON.parse(localStorage.getItem(CLE_CREDITS) ?? "null") as { v: number; jours: Record<string, number> } | null;
const poserCredits = (jours: Record<string, unknown>) => localStorage.setItem(CLE_CREDITS, JSON.stringify({ v: 1, jours }));
const sante = async () => (await import("../../store/health")).healthStore;

describe("CryptoQuant : budget de crédits (§13, C1 à C4, C6)", () => {
  beforeEach(() => { reinitialiser(); cle.valeur = "perso"; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(T0); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it.each([
    ["x-credit-cost: 15", { "x-credit-cost": "15" }, 15],
    ["sans en-tête", {}, 15],
    ["x-credit-cost: 7 (coût réel moindre)", { "x-credit-cost": "7" }, 7],
    ["x-credit-cost: 0", { "x-credit-cost": "0" }, 0],
    ["x-credit-cost: 1000 (borne haute)", { "x-credit-cost": "1000" }, 1_000],
    ["x-credit-cost: abc", { "x-credit-cost": "abc" }, 15],
    ["x-credit-cost vide", { "x-credit-cost": " " }, 15],
    ["x-credit-cost: -1", { "x-credit-cost": "-1" }, 15],
    ["x-credit-cost: 1.5", { "x-credit-cost": "1.5" }, 15],
    ["x-credit-cost: 1001", { "x-credit-cost": "1001" }, 15],
  ] as const)("C2 — 200 (%s) : coût compté au jour UTC courant et publié dans DATA", async (_n, entetes, attendu) => {
    const cq = await import("./cryptoquant");
    const healthStore = await sante();
    poser(arch(plage(-30, -2), null));
    reseau(api200Entetes({ ...entetes }));
    expect(await cq.chargerSerieCq("taker:spot:btc")).toMatchObject({ statut: "pret", appel: true });
    expect(credits()).toEqual({ v: 1, jours: { [J(0)]: attendu } });
    expect(healthStore.getState().sources.cryptoquant?.quota).toEqual({ utilise: 1, limite: 10, fenetre: "1min",
      credits: { utilise: attendu, limite: 10_000, jours: 31 } });
  });

  it.each([
    ["401", () => statut(401, "", { "x-credit-cost": "15" })],
    ["402", () => statut(402, "", { "x-credit-cost": "15" })],
    ["403", () => statut(403, "Professional plan and above", { "x-credit-cost": "15" })],
    ["429", () => statut(429, "", { "x-credit-cost": "15", "retry-after": "1" })],
    ["500", () => new Response("panne", { status: 500, headers: { "x-credit-cost": "15" } })],
    ["réseau", () => { throw new TypeError("échec"); }],
  ] as const)("C2 — échec %s : 0 crédit compté, compteur jamais écrit", async (_n, api) => {
    const cq = await import("./cryptoquant");
    const healthStore = await sante();
    poser(arch(plage(-30, -2), null));
    reseau(api);
    expect((await cq.chargerSerieCq("taker:spot:btc")).appel).toBe(true);
    expect(credits()).toBeNull();
    expect(healthStore.getState().sources.cryptoquant?.quota?.credits?.utilise).toBe(0);
  });

  it("C1 — 402 : statut credits, raison fixe, santé, mémoire globale 24 h, effacée par setKey ; corps jamais lu", async () => {
    const cq = await import("./cryptoquant");
    const healthStore = await sante();
    const { cryptoquantKeyStore } = await import("../../store/cryptoquant");
    const MARQUEUR = "MARQUEUR-CORPS-402";
    poser(arch(plage(-30, -2), null));
    const setItem = vi.spyOn(localStorage, "setItem");
    const f = reseau(() => statut(402, MARQUEUR));
    const r = await cq.chargerSerieCq("taker:spot:btc");
    expect(r).toMatchObject({ statut: "credits", raison: cq.RAISON_CREDITS_EPUISES_CQ, appel: true });
    expect(r.raison).toBe("Crédits mensuels CryptoQuant épuisés (402) : plus d'appel avant la remise à zéro mensuelle ; archive affichée.");
    expect(Object.keys(r.archive?.jours ?? {})).toHaveLength(29);
    expect(healthStore.getState().sources.cryptoquant).toMatchObject({ etat: "error", derniereErreur: "CryptoQuant : crédits mensuels épuisés" });
    // Mémoire GLOBALE : l'autre famille ne rappelle pas, sans consommer de créneau.
    expect(await cq.chargerSerieCq("mineur:mara")).toMatchObject({ statut: "credits", raison: cq.RAISON_CREDITS_EPUISES_CQ, appel: false });
    expect([appels(f).length, cq.etatFileCq()]).toEqual([1, { enAttente: 0, repriseTs: null }]);
    // 24 h moins 1 ms : toujours mémorisé ; 24 h : un nouvel essai est gratuit.
    vi.setSystemTime(T0 + 24 * 3600_000 - 1);
    expect(await cq.chargerSerieCq("taker:swap:btc")).toMatchObject({ statut: "credits", appel: false });
    vi.setSystemTime(T0 + 24 * 3600_000);
    expect(await cq.chargerSerieCq("taker:swap:btc")).toMatchObject({ statut: "credits", appel: true });
    expect(appels(f)).toHaveLength(2);
    // Rotation de clé : mémoire abandonnée comme `refusCle`.
    cryptoquantKeyStore.getState().setKey("nouvelle");
    expect(await cq.chargerSerieCq("mineur:riot")).toMatchObject({ statut: "credits", appel: true });
    expect(appels(f)).toHaveLength(3);
    // Aucun crédit compté, aucune trace du corps amont.
    expect(credits()).toBeNull();
    const traces = [...f.mock.calls.map(([u]) => String(u)), r, cq.etatFileCq(), healthStore.getState().sources, ...setItem.mock.calls].map((t) => JSON.stringify(t));
    expect(traces.filter((t) => t.includes(MARQUEUR))).toEqual([]);
  });

  it("C3 — 8 990 crédits sur 31 j : credits (raison budget avec la somme entière), 0 fetch, créneau non consommé", async () => {
    poserCredits({ [J(-45)]: 5_000, [J(-3)]: 4_000, [J(-2)]: 4_000, [J(-1)]: 990 });
    const cq = await import("./cryptoquant");
    const healthStore = await sante();
    poser(arch(plage(-30, -2), null));
    const f = reseau(aucun);
    const r = await cq.chargerSerieCq("taker:spot:btc");
    expect(r).toMatchObject({ statut: "credits", raison: cq.raisonBudgetCreditsCq(8_990), appel: false });
    expect(r.raison).toBe("Budget de crédits CryptoQuant atteint (≈ 8990/10 000 sur 31 j, ce navigateur) : appels suspendus pour préserver le mois ; archive affichée.");
    expect(Object.keys(r.archive?.jours ?? {})).toHaveLength(29);
    expect([appels(f).length, cq.etatFileCq()]).toEqual([0, { enAttente: 0, repriseTs: null }]);
    // Publié dès le premier chargement du module (somme non nulle), sans créneau.
    expect(healthStore.getState().sources.cryptoquant?.quota).toEqual({ utilise: 0, limite: 10, fenetre: "1min",
      credits: { utilise: 8_990, limite: 10_000, jours: 31 } });
    // 8 985 : 8 985 + 15 = 9 000 ≤ plafond → l'appel part.
    vi.resetModules();
    vi.stubGlobal("localStorage", stockage());
    poserCredits({ [J(-1)]: 8_985 });
    const cq2 = await import("./cryptoquant");
    poser(arch(plage(-30, -2), null));
    const g = reseau(api200);
    expect(await cq2.chargerSerieCq("taker:spot:btc")).toMatchObject({ statut: "pret", appel: true });
    expect(appels(g)).toHaveLength(1);
  });

  it("constantes figées (§13) : plafond 9 000 et coût par défaut 15", async () => {
    const cq = await import("./cryptoquant");
    expect([cq.PLAFOND_CREDITS_CQ, cq.COUT_CREDITS_DEFAUT_CQ]).toEqual([9_000, 15]);
  });

  it("C3 — fenêtre 31 j = jour courant + 30 précédents : J-30 compté, J-31 et un jour futur ignorés puis élagués", async () => {
    poserCredits({ [J(-31)]: 300, [J(-30)]: 45, [J(-1)]: 15, [J(40)]: 8_000 });
    const cq = await import("./cryptoquant");
    const healthStore = await sante();
    expect(healthStore.getState().sources.cryptoquant?.quota?.credits?.utilise).toBe(60);
    poser(arch(plage(-30, -2), null));
    reseau(api200);
    expect(await cq.chargerSerieCq("taker:spot:btc")).toMatchObject({ statut: "pret", appel: true });
    expect(credits()).toEqual({ v: 1, jours: { [J(-30)]: 45, [J(-1)]: 15, [J(0)]: 15 } });
    expect(healthStore.getState().sources.cryptoquant?.quota?.credits?.utilise).toBe(75);
  });

  it("C4 — compteur illisible, `v` inconnue ou valeurs absurdes → vide puis remplacé", async () => {
    localStorage.setItem(CLE_CREDITS, "{pas du json");
    let cq = await import("./cryptoquant");
    poser(arch(plage(-30, -2), null));
    reseau(api200);
    expect(await cq.chargerSerieCq("taker:spot:btc")).toMatchObject({ statut: "pret", appel: true });
    expect(credits()).toEqual({ v: 1, jours: { [J(0)]: 15 } });
    // `v` inconnue : 9 000 crédits NON lus (sinon le plafond bloquerait l'appel), fichier remplacé.
    vi.resetModules();
    vi.stubGlobal("localStorage", stockage());
    localStorage.setItem(CLE_CREDITS, JSON.stringify({ v: 2, jours: { [J(-1)]: 9_000 } }));
    cq = await import("./cryptoquant");
    poser(arch(plage(-30, -2), null));
    reseau(api200);
    expect(await cq.chargerSerieCq("taker:spot:btc")).toMatchObject({ statut: "pret", appel: true });
    expect(credits()).toEqual({ v: 1, jours: { [J(0)]: 15 } });
    // Jour ou valeur absurde (négatif, non entier, non numérique, clé qui n'est pas un jour) : ignoré.
    vi.resetModules();
    vi.stubGlobal("localStorage", stockage());
    poserCredits({ [J(-1)]: -5, [J(-2)]: 1.5, [J(-3)]: "abc", [J(-4)]: 20, "pas-un-jour": 9_000 });
    await import("./cryptoquant");
    expect((await sante()).getState().sources.cryptoquant?.quota?.credits?.utilise).toBe(20);
  });

  it("C4 — écriture du compteur en échec : la somme de la session inclut quand même l'appel", async () => {
    const cq = await import("./cryptoquant");
    const healthStore = await sante();
    poser(arch(plage(-30, -2), null));
    localStorage.setItem = () => { throw new DOMException("quota", "QuotaExceededError"); };
    reseau(api200);
    expect(await cq.chargerSerieCq("taker:spot:btc")).toMatchObject({ statut: "pret", appel: true, persistance: { local: false } });
    expect(healthStore.getState().sources.cryptoquant?.quota?.credits?.utilise).toBe(15);
  });

  it("premier chargement du module : somme nulle → aucune ligne de santé publiée", async () => {
    await import("./cryptoquant");
    expect((await sante()).getState().sources.cryptoquant).toBeUndefined();
  });

  it.each([
    ["le plafond franchi par la série précédente (200)", api200, (cq: typeof import("./cryptoquant")): string => cq.raisonBudgetCreditsCq(9_000)],
    ["un 402 reçu par la série précédente", () => statut(402), (cq: typeof import("./cryptoquant")): string => cq.RAISON_CREDITS_EPUISES_CQ],
  ] as const)("créneau obtenu après %s : re-contrôle, aucun fetch, statut credits", async (_n, reponse, raison) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(T0);
    poserCredits({ [J(-1)]: 8_985 });
    const cq = await import("./cryptoquant");
    const libre = new AbortController().signal;
    for (let i = 0; i < 9; i++) await cq.acquerirCreneauCq(libre);
    let repondre = (_r: Response) => {};
    const f = reseau((u) => {
      if (u.includes("btc_all")) return new Promise<Response>((r) => { repondre = r; });
      throw new Error("appel CryptoQuant inattendu");
    });
    const premiere = cq.chargerSerieCq("taker:spot:btc");
    await tourner();
    expect(appels(f)).toHaveLength(1);
    // Dernière série : aucun créneau libre (10/10), elle attend — ses deux contrôles sont déjà passés.
    let seconde: ChargementCq | undefined;
    void cq.chargerSerieCq("mineur:mara").then((x) => { seconde = x; });
    await tourner();
    expect([cq.etatFileCq().enAttente, seconde]).toEqual([1, undefined]);
    repondre(reponse());
    await tourner();
    expect((await premiere).statut).toBe(reponse === api200 ? "pret" : "credits");
    await avancer(60_000);
    await tourner();
    expect(seconde).toMatchObject({ statut: "credits", raison: raison(cq), appel: false });
    expect(appels(f)).toHaveLength(1);
  });

  it("C6 — 200 vide : facturé, archive inchangée, heure mémorisée par série sous la même reprise 12 h", async () => {
    const cq = await import("./cryptoquant");
    // majTs déjà à 12 h pile : la reprise sur `majTs` seule LAISSERAIT partir un appel — isole le
    // nouveau mécanisme (mémoire de la réponse vide), qui ne dépend pas de `majTs`.
    const avant = arch(plage(-30, -2), T0 - DOUZE_H);
    poser(avant);
    const f = reseau(() => Response.json({ status: { code: 200 }, result: { data: [] } }));
    const r = await cq.chargerSerieCq("taker:spot:btc");
    expect(r).toMatchObject({ statut: "erreur", raison: cq.RAISON_ERREUR_CRYPTOQUANT, appel: true });
    expect([r.archive, relire()]).toEqual([avant, avant]);
    expect(credits()).toEqual({ v: 1, jours: { [J(0)]: 15 } });
    expect(appels(f)).toHaveLength(1);
    // now − 11 h 59 depuis la réponse vide : reprise active, 0 appel, archive et compteur inchangés.
    vi.setSystemTime(T0 + DOUZE_H - 1);
    expect(await cq.chargerSerieCq("taker:spot:btc")).toMatchObject({ statut: "pret", appel: false });
    expect([appels(f).length, relire(), credits()]).toEqual([1, avant, { v: 1, jours: { [J(0)]: 15 } }]);
    // now − 12 h pile depuis la réponse vide : reprise échue, nouvel appel.
    vi.setSystemTime(T0 + DOUZE_H);
    expect(await cq.chargerSerieCq("taker:spot:btc")).toMatchObject({ statut: "erreur", appel: true });
    expect(appels(f)).toHaveLength(2);
  });
});
