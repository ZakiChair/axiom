import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
function createLocalStorageMock(): Storage {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k), clear: () => data.clear(), key: (i) => [...data.keys()][i] ?? null,
    get length() { return data.size; } };
}

describe("BGeometrics partagé : budget, accès et fraîcheur", () => {
  beforeEach(() => { vi.resetModules(); vi.stubGlobal("localStorage", createLocalStorageMock()); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it("deux consommateurs de la même métrique partagent un seul fetch", async () => {
    const bg = await import("./bgeometrics");
    let demandes = 0;
    vi.stubGlobal("fetch", vi.fn(async () => { demandes++; return Response.json([{ unixTs: Date.now() / 1000, realizedPriceSth: 70_000 }]); }));
    const [a, b] = await Promise.all([bg.chargerBgeometricMetrique(bg.BG_STH_REALIZED_PRICE), bg.chargerBgeometricMetrique(bg.BG_STH_REALIZED_PRICE)]);
    expect(demandes).toBe(1);
    expect(a.resultat?.serie.dernier?.value).toBe(70_000);
    expect(b.resultat?.serie.dernier?.value).toBe(70_000);
  });
  it("budget horaire épuisé : aucun appel et motif quota", async () => {
    const bg = await import("./bgeometrics");
    localStorage.setItem(bg.cleStockageQuota(true), "10");
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const r = await bg.chargerBgeometricMetrique(bg.BG_REALIZED_CAP, "personnelle");
    expect(r.statut).toBe("quota");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("429 suspend les demandes suivantes pendant Retry-After au lieu d'épuiser la file", async () => {
    const bg = await import("./bgeometrics");
    const fetcher = vi.fn(async () => new Response(null, { status: 429, headers: { "retry-after": "60" } }));
    vi.stubGlobal("fetch", fetcher);
    expect((await bg.chargerBgeometricMetrique(bg.BG_STH_REALIZED_PRICE)).statut).toBe("quota");
    expect((await bg.chargerBgeometricMetrique(bg.BG_LTH_REALIZED_PRICE)).statut).toBe("quota");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("403 d'un netflow : abonnement explicite, la métrique gratuite suivante reste accessible", async () => {
    const bg = await import("./bgeometrics");
    vi.stubGlobal("fetch", vi.fn(async (url) => String(url).includes("netflow")
      ? Response.json({ code: "INVALID_TOKEN" }, { status: 403 })
      : Response.json([{ unixTs: Date.now() / 1000, realizedPriceLth: 48_000 }])));
    const payant = await bg.chargerBgeometricMetrique(bg.BG_EXCHANGE_NETFLOW, "personnelle");
    expect(payant.statut).toBe("abonnement");
    expect(payant.raison).toContain("abonnement");
    expect((await bg.chargerBgeometricMetrique(bg.BG_LTH_REALIZED_PRICE, "personnelle")).resultat?.serie.dernier?.value).toBe(48_000);
  });
  it("donnée observée ancienne reste périmée malgré récupération maintenant et cache 24 h", async () => {
    const bg = await import("./bgeometrics");
    const fetcher = vi.fn(async () => Response.json([{ unixTs: 1609459200, realizedCap: 100 }]));
    vi.stubGlobal("fetch", fetcher);
    const a = await bg.chargerBgeometricMetrique(bg.BG_REALIZED_CAP);
    const b = await bg.chargerBgeometricMetrique(bg.BG_REALIZED_CAP);
    expect(a.resultat?.perime).toBe(true);
    expect(b.resultat?.perime).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fermer le seul consommateur d'une métrique en attente évite de consommer son quota", async () => {
    const bg = await import("./bgeometrics");
    let finir!: (r: Response) => void;
    let appels = 0;
    vi.stubGlobal("fetch", vi.fn(() => { appels++; return new Promise<Response>((resolve) => { finir = resolve; }); }));
    const premier = bg.chargerBgeometricMetrique(bg.BG_STH_REALIZED_PRICE);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const ctrl = new AbortController();
    const second = bg.chargerBgeometricMetrique(bg.BG_LTH_REALIZED_PRICE, null, ctrl.signal);
    ctrl.abort();
    expect((await second).statut).toBe("annule");
    finir(Response.json([{ unixTs: Date.now() / 1000, realizedPriceSth: 70_000 }]));
    await premier;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(appels).toBe(1);
  });
  it("annuler un consommateur ne coupe pas celui qui attend encore la même métrique", async () => {
    const bg = await import("./bgeometrics");
    let finir!: (r: Response) => void;
    let signalReseau: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url, init) => { signalReseau = init.signal; return new Promise<Response>((resolve) => { finir = resolve; }); }));
    const ctrl = new AbortController();
    const a = bg.chargerBgeometricMetrique(bg.BG_STH_REALIZED_PRICE, null, ctrl.signal);
    const b = bg.chargerBgeometricMetrique(bg.BG_STH_REALIZED_PRICE);
    await new Promise((resolve) => setTimeout(resolve, 0));
    ctrl.abort();
    expect((await a).statut).toBe("annule");
    expect(signalReseau?.aborted).toBe(false);
    finir(Response.json([{ unixTs: Date.now() / 1000, realizedPriceSth: 70_000 }]));
    expect((await b).resultat?.serie.dernier?.value).toBe(70_000);
  });
});
