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

// --- Orchestrateur (tâche 13) ---
const brute = (jour: string) => ({ datetime: `${jour} 00:00:00`, trade_count: 1, base_volume: 2, quote_volume: 3, base_buy_volume: 4,
  quote_buy_volume: 5, base_sell_volume: 6, quote_sell_volume: 7, vwap: 8, buy_ratio: 0.5, buy_sell_ratio: 1, buy_count: 9, sell_count: 10 });
const api200 = () => Response.json({ status: { code: 200 }, result: { data: plage(-30, -1).reverse().map(brute) } });
const statut = (status: number, message = "", headers: Record<string, string> = {}) => Response.json({ status: { code: status, message } }, { status, headers });
const appels = (f: ReturnType<typeof reseau>) => f.mock.calls.filter(([u]) => String(u).startsWith("/cqapi/"));
const SIX_H = 6 * 3600_000;
const SECRET = "CLE-TEST-SECRETE";
/** Horloge réelle pour `setTimeout` (seul `Date` est simulé ici) : laisse avancer les promesses jusqu'à la condition. */
const jusqua = async (condition: () => boolean) => {
  for (let i = 0; i < 100 && !condition(); i++) await new Promise((r) => setTimeout(r, 0));
};

describe("CryptoQuant : chargerSerieCq (I5, I7, I9, I10)", () => {
  beforeEach(() => { reinitialiser(); cle.valeur = "perso"; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(T0); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.doUnmock("../../lib/deployment"); });

  it("J-1 archivé ou appel < 6 h → 0 appel ; ≥ 6 h → 1 appel exact, fusion écrite, santé polling", async () => {
    const cq = await import("./cryptoquant");
    const { healthStore } = await import("../../store/health");
    const f = reseau(api200);
    poser(arch(plage(-30, -1), 0));
    expect(await cq.chargerSerieCq("taker:spot:btc")).toMatchObject({ statut: "pret", raison: null, appel: false, diagnostic: { hierPresent: true } });
    poser(arch(plage(-40, -2), T0 - SIX_H + 1));
    expect(await cq.chargerSerieCq("taker:spot:btc")).toMatchObject({ statut: "pret", appel: false });
    expect(appels(f)).toHaveLength(0);
    poser(arch(plage(-40, -2), T0 - SIX_H));
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
    const avant = arch(plage(-30, -2), T0 - SIX_H);
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
    reseau(api200, kvOk(arch(plage(-401, -2), T0 - SIX_H)));
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
});
