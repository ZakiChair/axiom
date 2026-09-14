/**
 * Trésoreries d'entreprises BTC (CoinGecko public_treasury) : parse, prix de revient,
 * sociétés sous leur coût, sensibilité, et chargeur (un appel, cache 6 h, coalescence, repli).
 *
 * Oracles réels relus le 2026-09-14 (sonde `companies/public_treasury/bitcoin`) : 180 sociétés,
 * 1 294 580 BTC, prix implicite 79 175,91 $ ; filtre [1 000 ; 200 000] $/BTC → 91 sociétés,
 * 1 054 328 BTC (couverture 81,44 %), coût pondéré 76 692,60 $ ; Strategy 845 050 BTC à
 * 76 052,10 $ (spot +4,11 %, sous son coût dès −3,9 %) ; sous leur coût 62 sociétés / 133 849 BTC,
 * à −10 % 67 / 983 251, à −20 % 74 / 1 008 699, à −30 % 77 / 1 010 842 ; Linekong (634,71 $)
 * écartée, Twenty One (entry 0) sans coût.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseTresoreriesBtc, resumerTresoreries, URL_TRESORERIES_BTC } from "./tresoreriesBtc";

const SPOT = 79_175.91;
const societe = (name: string, symbol: string, total_holdings: number, total_entry_value_usd: number) =>
  ({ name, symbol, country: "XX", total_holdings, total_entry_value_usd, total_current_value_usd: total_holdings * SPOT, percentage_of_total_supply: 0 });

/** Cinq sociétés : Strategy, Twenty One (sans coût), Linekong (coût aberrant), Metaplanet (au-dessus du spot), une sous le spot. */
const FIXTURE = {
  total_holdings: 941_581,
  total_value_usd: 941_581 * SPOT,
  market_cap_dominance: 4.48,
  companies: [
    societe("Strategy", "MSTR.US", 845_050, 64_267_830_000),
    societe("Twenty One Capital", "XXI.US", 43_514, 0),
    societe("Linekong Interactive", "8267.HK", 17, 17 * 634.71),
    societe("Metaplanet", "3350.T", 43_000, 3_810_765_023.48),
    societe("Société B", "B.US", 10_000, 600_000_000),
  ],
};

describe("parseTresoreriesBtc", () => {
  it("lit les totaux et les sociétés ; coût nul ou hors [1 000 ; 200 000] $/BTC → coût inconnu", () => {
    const t = parseTresoreriesBtc(FIXTURE)!;
    expect(t.totalBtc).toBe(941_581);
    expect(t.valeurUsd! / t.totalBtc).toBeCloseTo(SPOT, 6);
    expect(t.societes).toHaveLength(5);
    expect(t.societes[0]).toEqual({ nom: "Strategy", symbole: "MSTR.US", avoirsBtc: 845_050, coutTotalUsd: 64_267_830_000 });
    expect(t.societes.find((s) => s.symbole === "XXI.US")?.coutTotalUsd).toBeNull();
    expect(t.societes.find((s) => s.symbole === "8267.HK")?.coutTotalUsd).toBeNull();
    expect(t.societes.find((s) => s.symbole === "3350.T")?.coutTotalUsd).toBe(3_810_765_023.48);
  });

  it("ignore les sociétés sans avoirs finis positifs ; total racine absent → somme des avoirs, valeur absente → null", () => {
    const t = parseTresoreriesBtc({
      companies: [societe("A", "A.US", 100, 5_000_000), { name: "Vide", symbol: "V", total_holdings: 0 }, { name: "Texte", total_holdings: "12" }],
    })!;
    expect(t.societes.map((s) => s.nom)).toEqual(["A"]);
    expect(t.totalBtc).toBe(100);
    expect(t.valeurUsd).toBeNull();
  });

  it("JSON malformé ou sans société exploitable → null", () => {
    expect(parseTresoreriesBtc(null)).toBeNull();
    expect(parseTresoreriesBtc("x")).toBeNull();
    expect(parseTresoreriesBtc({ companies: "x" })).toBeNull();
    expect(parseTresoreriesBtc({ total_holdings: 10, companies: [] })).toBeNull();
    expect(parseTresoreriesBtc({ companies: [{ name: "Z", total_holdings: -1 }] })).toBeNull();
  });
});

describe("resumerTresoreries", () => {
  it("Strategy, coût pondéré, couverture, sous leur coût et sensibilité au prix implicite CoinGecko", () => {
    const r = resumerTresoreries(parseTresoreriesBtc(FIXTURE)!);
    expect(r.totalBtc).toBe(941_581);
    expect(r.nbSocietes).toBe(5);
    expect(r.spotImpliciteUsd).toBeCloseTo(SPOT, 6);
    expect(r.strategy!.avoirsBtc).toBe(845_050);
    expect(r.strategy!.coutMoyenUsd).toBeCloseTo(76_052.1034, 3);
    // Écart du spot au coût : 79 175,91 / 76 052,10 − 1 ; passage sous le coût : 76 052,10 / 79 175,91 − 1.
    expect(r.strategy!.ecartSpotPct).toBeCloseTo(4.107456, 5);
    expect(r.strategy!.seuilSousCoutPct).toBeCloseTo(-3.945400, 5);
    // Coût connu : Strategy, Metaplanet, Société B (Twenty One sans coût, Linekong écartée).
    expect(r.nbAvecCout).toBe(3);
    expect(r.coutPondereUsd).toBeCloseTo(76_475.246393, 5);
    expect(r.couvertureCoutPct).toBeCloseTo(95.376818, 5);
    expect(r.sousCout).toEqual({ societes: 1, btc: 43_000 });
    expect(r.sensibilite.map((p) => p.baissePct)).toEqual([10, 20, 30]);
    expect(r.sensibilite[0]!.prixUsd).toBeCloseTo(71_258.319, 6);
    expect(r.sensibilite.map(({ societes, btc }) => [societes, btc])).toEqual([[2, 888_050], [2, 888_050], [3, 898_050]]);
  });

  it("spot fourni : il remplace le prix implicite ; un décompte nul mesuré reste zéro", () => {
    const r = resumerTresoreries(parseTresoreriesBtc(FIXTURE)!, 100_000);
    expect(r.spotImpliciteUsd).toBe(100_000);
    expect(r.sousCout).toEqual({ societes: 0, btc: 0 });
    expect(r.sensibilite[0]).toMatchObject({ baissePct: 10, prixUsd: 90_000, societes: 0, btc: 0 });
  });

  it("sans valeur ni spot : aucun écart, aucun décompte ni sensibilité inventés", () => {
    const t = { ...parseTresoreriesBtc(FIXTURE)!, valeurUsd: null };
    const r = resumerTresoreries(t);
    expect(r.spotImpliciteUsd).toBeNull();
    expect(r.strategy).toMatchObject({ avoirsBtc: 845_050, ecartSpotPct: null, seuilSousCoutPct: null });
    expect(r.strategy!.coutMoyenUsd).toBeCloseTo(76_052.1034, 3);
    expect(r.coutPondereUsd).toBeCloseTo(76_475.246393, 5);
    expect(r.sousCout).toBeNull();
    expect(r.sensibilite).toEqual([]);
  });

  it("Strategy absente → null ; aucune société à coût connu → coût pondéré, couverture et décomptes null", () => {
    const t = parseTresoreriesBtc({ total_holdings: 10, total_value_usd: 10 * SPOT, companies: [societe("Sans coût", "S.US", 10, 0)] })!;
    const r = resumerTresoreries(t);
    expect(r.strategy).toBeNull();
    expect(r.nbAvecCout).toBe(0);
    expect(r.coutPondereUsd).toBeNull();
    expect(r.couvertureCoutPct).toBeNull();
    expect(r.sousCout).toBeNull();
    expect(r.sensibilite).toEqual([]);
  });
});

function stockage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

const CLE_CACHE = "axiom:onchain:cg:tresoreries:btc";
const reponse = (status: number, corps: unknown = FIXTURE) => new Response(JSON.stringify(corps), { status });

describe("chargerTresoreriesBtc : un appel, cache 6 h, coalescence, repli périmé", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", stockage());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("appelle l'endpoint public sans clé, écrit le cache, puis le relit sans second appel", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => reponse(200));
    vi.stubGlobal("fetch", fetcher);
    const { chargerTresoreriesBtc } = await import("./tresoreriesBtc");
    const r = await chargerTresoreriesBtc();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]![0])).toBe(URL_TRESORERIES_BTC);
    expect(URL_TRESORERIES_BTC).toBe("https://api.coingecko.com/api/v3/companies/public_treasury/bitcoin");
    expect(r).toMatchObject({ perime: false });
    expect(r!.donnee.societes).toHaveLength(5);
    expect(JSON.parse(localStorage.getItem(CLE_CACHE)!).donnee.totalBtc).toBe(941_581);
    const encore = await chargerTresoreriesBtc();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(encore).toMatchObject({ perime: false, ts: r!.ts });
  });

  it("ajoute la clé Demo personnelle quand elle existe ; accès « cle »", async () => {
    localStorage.setItem("axiom.coingecko.demoApiKey", "cle-demo");
    const fetcher = vi.fn<typeof fetch>(async () => reponse(200));
    vi.stubGlobal("fetch", fetcher);
    const { accesTresoreries, chargerTresoreriesBtc } = await import("./tresoreriesBtc");
    await chargerTresoreriesBtc();
    expect(String(fetcher.mock.calls[0]![0])).toBe(`${URL_TRESORERIES_BTC}?x_cg_demo_api_key=cle-demo`);
    expect(accesTresoreries()).toBe("cle");
    localStorage.removeItem("axiom.coingecko.demoApiKey");
    expect(accesTresoreries()).toBe("public");
  });

  it("deux appels concurrents partagent un seul téléchargement", async () => {
    let liberer: (r: Response) => void = () => {};
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => { liberer = resolve; }));
    vi.stubGlobal("fetch", fetcher);
    const { chargerTresoreriesBtc } = await import("./tresoreriesBtc");
    const a = chargerTresoreriesBtc();
    const b = chargerTresoreriesBtc();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    liberer(reponse(200));
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toEqual(rb);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("l'abandon d'un appelant ne coupe pas le téléchargement partagé d'un autre", async () => {
    let liberer: (r: Response) => void = () => {};
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => { liberer = resolve; }));
    vi.stubGlobal("fetch", fetcher);
    const { chargerTresoreriesBtc } = await import("./tresoreriesBtc");
    const ctrl = new AbortController();
    const a = chargerTresoreriesBtc(ctrl.signal);
    const b = chargerTresoreriesBtc();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    ctrl.abort();
    liberer(reponse(200));
    await expect(a).rejects.toMatchObject({ name: "AbortError" });
    expect((await b)!.donnee.totalBtc).toBe(941_581);
  });

  it.each([429, 503])("HTTP %i avec cache expiré → cache resservi « périmé »", async (status) => {
    const ancien = Date.now() - 7 * 3_600_000;
    localStorage.setItem(CLE_CACHE, JSON.stringify({ ts: ancien, donnee: parseTresoreriesBtc(FIXTURE) }));
    const fetcher = vi.fn<typeof fetch>(async () => reponse(status, { status: { error_code: status } }));
    vi.stubGlobal("fetch", fetcher);
    const { chargerTresoreriesBtc } = await import("./tresoreriesBtc");
    const r = await chargerTresoreriesBtc();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ perime: true, ts: ancien });
    expect(r!.donnee.totalBtc).toBe(941_581);
  });

  it("échec sans cache (HTTP 503 ou réponse illisible) → null, sans exception", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => reponse(503)));
    const mod = await import("./tresoreriesBtc");
    expect(await mod.chargerTresoreriesBtc()).toBeNull();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => reponse(200, { companies: [] })));
    expect(await mod.chargerTresoreriesBtc()).toBeNull();
    expect(localStorage.getItem(CLE_CACHE)).toBeNull();
  });
});
