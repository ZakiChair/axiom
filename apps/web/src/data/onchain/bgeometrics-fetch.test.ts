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

describe("BGeometrics : mémoire du refus d'abonnement", () => {
  const CLE_MEMOIRE = "axiom:onchain:bg:abonnement-refuse";
  beforeEach(() => { vi.resetModules(); vi.stubGlobal("localStorage", createLocalStorageMock()); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  const refus403 = () => vi.fn(async () => Response.json({ code: "INVALID_TOKEN" }, { status: 403 }));
  const compteurs = (bg: typeof import("./bgeometrics")) =>
    [localStorage.getItem(bg.cleStockageQuota(true)), localStorage.getItem(bg.cleStockageQuota(false))];

  it("après un 403 sur netflow, exchange-reserve répond « abonnement » sans appel ni compteur", async () => {
    const bg = await import("./bgeometrics");
    const fetcher = refus403(); vi.stubGlobal("fetch", fetcher);
    expect((await bg.chargerBgeometricMetrique(bg.BG_EXCHANGE_NETFLOW, "personnelle")).statut).toBe("abonnement");
    const avant = compteurs(bg);
    const reserve = await bg.chargerBgeometricMetrique(bg.BG_EXCHANGE_RESERVE, "personnelle");
    expect(reserve.statut).toBe("abonnement");
    expect(reserve.raison).toContain("abonnement");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(compteurs(bg)).toEqual(avant);
    // La mémoire ne contient jamais la valeur de la clé.
    expect(localStorage.getItem(CLE_MEMOIRE)).not.toBeNull();
    expect(localStorage.getItem(CLE_MEMOIRE)).not.toContain("personnelle");
  });

  it("la mémoire survit au rechargement du module", async () => {
    const bg = await import("./bgeometrics");
    const fetcher = refus403(); vi.stubGlobal("fetch", fetcher);
    await bg.chargerBgeometricMetrique(bg.BG_EXCHANGE_NETFLOW, "personnelle");
    vi.resetModules();
    const relu = await import("./bgeometrics");
    expect((await relu.chargerBgeometricMetrique(relu.BG_EXCHANGE_RESERVE, "personnelle")).statut).toBe("abonnement");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("la mémoire expire après 24 h", async () => {
    const bg = await import("./bgeometrics");
    const fetcher = refus403(); vi.stubGlobal("fetch", fetcher);
    await bg.chargerBgeometricMetrique(bg.BG_EXCHANGE_NETFLOW, "personnelle");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 24 * 3600_000 + 1);
    await bg.chargerBgeometricMetrique(bg.BG_EXCHANGE_RESERVE, "personnelle");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("changer ou retirer la clé personnelle efface la mémoire", async () => {
    const bg = await import("./bgeometrics");
    const { bgeometricsKeyStore } = await import("../../store/onchain");
    const fetcher = refus403(); vi.stubGlobal("fetch", fetcher);
    await bg.chargerBgeometricMetrique(bg.BG_EXCHANGE_NETFLOW, "personnelle");
    bgeometricsKeyStore.getState().setKey("nouvelle");
    expect(localStorage.getItem(CLE_MEMOIRE)).toBeNull();
    await bg.chargerBgeometricMetrique(bg.BG_EXCHANGE_RESERVE, "nouvelle");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(CLE_MEMOIRE)).not.toBeNull();
    bgeometricsKeyStore.getState().clearKey();
    expect(localStorage.getItem(CLE_MEMOIRE)).toBeNull();
  });

  // Seul le sens « mémoire env → clé personnelle » est testé : l'accès env dépend du
  // `define` BG_CLE_ENV_PRESENTE (présence du .env), non déterministe en test.
  it("une mémoire d'un autre type d'accès est ignorée", async () => {
    const bg = await import("./bgeometrics");
    localStorage.setItem(CLE_MEMOIRE, JSON.stringify({ echeance: Date.now() + 3600_000, acces: "env" }));
    const fetcher = refus403(); vi.stubGlobal("fetch", fetcher);
    await bg.chargerBgeometricMetrique(bg.BG_EXCHANGE_RESERVE, "personnelle");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("mémoire consultée AVANT le quota : reserve dit « abonnement » même compteur horaire plein", async () => {
    const bg = await import("./bgeometrics");
    const fetcher = refus403(); vi.stubGlobal("fetch", fetcher);
    await bg.chargerBgeometricMetrique(bg.BG_EXCHANGE_NETFLOW, "personnelle");
    localStorage.setItem(bg.cleStockageQuota(true), String(bg.BG_LIMITE_HEURE));
    const reserve = await bg.chargerBgeometricMetrique(bg.BG_EXCHANGE_RESERVE, "personnelle");
    expect(reserve.statut).toBe("abonnement");
    expect(reserve.raison).toContain("abonnement");
    expect(reserve.raison).not.toContain("Quota");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("un 403 de l'ancienne clé revenu après un changement de clé ne réécrit pas la mémoire", async () => {
    const bg = await import("./bgeometrics");
    const { bgeometricsKeyStore } = await import("../../store/onchain");
    // Autre onglet : une nouvelle clé est enregistrée pendant que la requête de l'ancienne est en vol.
    vi.stubGlobal("fetch", vi.fn(async () => {
      bgeometricsKeyStore.getState().setKey("nouvelle");
      return Response.json({ code: "INVALID_TOKEN" }, { status: 403 });
    }));
    expect((await bg.chargerBgeometricMetrique(bg.BG_EXCHANGE_NETFLOW, "ancienne")).statut).toBe("abonnement");
    expect(localStorage.getItem(CLE_MEMOIRE)).toBeNull();
    const fetcher = refus403(); vi.stubGlobal("fetch", fetcher);
    await bg.chargerBgeometricMetrique(bg.BG_EXCHANGE_RESERVE, "nouvelle");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("idem quand la clé change pendant que la demande de l'ancienne attend dans la file", async () => {
    const bg = await import("./bgeometrics");
    const { bgeometricsKeyStore } = await import("../../store/onchain");
    let liberer!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn((url: string) => String(url).includes("netflow")
      ? Promise.resolve(Response.json({ code: "INVALID_TOKEN" }, { status: 403 }))
      : new Promise<Response>((resolve) => { liberer = resolve; })));
    const devant = bg.chargerBgeometricMetrique(bg.BG_REALIZED_CAP, "ancienne");
    const netflow = bg.chargerBgeometricMetrique(bg.BG_EXCHANGE_NETFLOW, "ancienne");
    await new Promise((resolve) => setTimeout(resolve, 0));
    bgeometricsKeyStore.getState().setKey("nouvelle");
    liberer(Response.json([{ unixTs: Date.now() / 1000, realizedCap: 1 }]));
    await devant;
    expect((await netflow).statut).toBe("abonnement");
    expect(localStorage.getItem(CLE_MEMOIRE)).toBeNull();
  });
});

describe("BGeometrics : quota publié dans la santé", () => {
  beforeEach(() => { vi.resetModules(); vi.stubGlobal("localStorage", createLocalStorageMock()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("clé active : le quota santé porte aussi le compteur journalier qui bloque", async () => {
    const bg = await import("./bgeometrics");
    const { healthStore } = await import("../../store/health");
    localStorage.setItem(bg.cleStockageQuota(true), "0");
    localStorage.setItem(bg.cleStockageQuota(false), String(bg.BG_LIMITE_JOUR));
    bg.publierQuotaBg("personnelle");
    expect(healthStore.getState().sources.bgeometrics?.quota).toEqual({ utilise: 0, limite: 10, fenetre: "1hour", jour: { utilise: 15, limite: 15 } });
  });

  it("appel abouti avec clé : quota horaire et journalier publiés", async () => {
    const bg = await import("./bgeometrics");
    const { healthStore } = await import("../../store/health");
    localStorage.setItem(bg.cleStockageQuota(false), "7");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([{ unixTs: Date.now() / 1000, realizedCap: 100 }])));
    expect((await bg.chargerBgeometricMetrique(bg.BG_REALIZED_CAP, "personnelle")).statut).toBe("pret");
    expect(healthStore.getState().sources.bgeometrics?.quota).toEqual({ utilise: 1, limite: 10, fenetre: "1hour", jour: { utilise: 8, limite: 15 } });
  });

  it("Open Interest futures avec clé : bloqué par le plafond journalier, puis quota journalier publié", async () => {
    const bg = await import("./bgeometrics");
    const { healthStore } = await import("../../store/health");
    const fetcher = vi.fn(async () => Response.json([{ d: "2026-09-14", unixTs: "1789344000", binance: "1" }]));
    vi.stubGlobal("fetch", fetcher);
    localStorage.setItem(bg.cleStockageQuota(false), String(bg.BG_LIMITE_JOUR));
    expect(await bg.fetchOiFuturesParExchange("personnelle")).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    localStorage.setItem(bg.cleStockageQuota(false), "3");
    expect((await bg.fetchOiFuturesParExchange("personnelle"))?.jours).toHaveLength(1);
    expect(healthStore.getState().sources.bgeometrics?.quota).toEqual({ utilise: 1, limite: 10, fenetre: "1hour", jour: { utilise: 4, limite: 15 } });
  });
});

describe("BGeometrics : plafond journalier et repli", () => {
  beforeEach(() => { vi.resetModules(); vi.stubGlobal("localStorage", createLocalStorageMock()); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  const cacheRealizedCap = (ageMs: number) => {
    const dernier = { time: Date.now(), value: 100 };
    localStorage.setItem("axiom:onchain:bg:realizedCap", JSON.stringify({ ts: Date.now() - ageMs, donnee: { points: [dernier], dernier } }));
  };

  it("compteur journalier à 15 avec clé active : statut quota sans appel", async () => {
    const bg = await import("./bgeometrics");
    localStorage.setItem(bg.cleStockageQuota(false), String(bg.BG_LIMITE_JOUR));
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const r = await bg.chargerBgeometricMetrique(bg.BG_REALIZED_CAP, "personnelle");
    expect(r.statut).toBe("quota");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("réponse fraîche d'observation ancienne : périmée mais pas un repli, cache frais idem", async () => {
    const bg = await import("./bgeometrics");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([{ unixTs: 1609459200, realizedCap: 100 }])));
    const reseau = await bg.chargerBgeometricMetrique(bg.BG_REALIZED_CAP);
    const cache = await bg.chargerBgeometricMetrique(bg.BG_REALIZED_CAP);
    expect(reseau.resultat).toMatchObject({ perime: true, repli: false });
    expect(cache.resultat).toMatchObject({ perime: true, repli: false });
  });

  it("cache frais d'observation récente : ni périmé ni repli", async () => {
    const bg = await import("./bgeometrics");
    cacheRealizedCap(3600_000);
    vi.stubGlobal("fetch", vi.fn());
    expect((await bg.chargerBgeometricMetrique(bg.BG_REALIZED_CAP, "personnelle")).resultat).toMatchObject({ perime: false, repli: false });
  });

  it.each([
    ["429", () => new Response(null, { status: 429, headers: { "retry-after": "60" } }), "quota"],
    ["erreur 500", () => new Response(null, { status: 500 }), "erreur"],
  ] as const)("%s avec cache expiré : valeur resservie marquée repli", async (_nom, reponse, statut) => {
    const bg = await import("./bgeometrics");
    cacheRealizedCap(25 * 3600_000);
    vi.stubGlobal("fetch", vi.fn(async () => reponse()));
    const r = await bg.chargerBgeometricMetrique(bg.BG_REALIZED_CAP, "personnelle");
    expect(r.statut).toBe(statut);
    expect(r.resultat).toMatchObject({ perime: true, repli: true });
  });

  it("quota local atteint avec cache expiré : valeur resservie marquée repli", async () => {
    const bg = await import("./bgeometrics");
    cacheRealizedCap(25 * 3600_000);
    localStorage.setItem(bg.cleStockageQuota(true), String(bg.BG_LIMITE_HEURE));
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const r = await bg.chargerBgeometricMetrique(bg.BG_REALIZED_CAP, "personnelle");
    expect(r.statut).toBe("quota");
    expect(r.resultat).toMatchObject({ perime: true, repli: true });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
