/**
 * Flux nets des exchanges (Coin Metrics community) : jointure, sommes calendaires,
 * z-score du Σ30 sur 730 j, statut flash, et chargeur BTC (cache 6 h, coalescence, repli).
 *
 * Oracles réels relus le 2026-09-14 (BTC, 805 lignes depuis 2024-07-01, dernier point
 * 2026-09-13) : flux net 1/7/30 j = −2 187 / −11 139 / −74 723 BTC, soit −167,9 M$ /
 * −859,5 M$ / −5 603 M$ ; z du Σ30 sur 730 j = −1,535.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dernierStatutCm,
  fluxNetQuotidien,
  resumerFluxNet,
  sommeJours,
  zScoreSommeGlissante,
} from "./fluxExchangesCm";

const JOUR = 86_400_000;
const debut = Date.UTC(2024, 0, 1);
const serie = (valeurs: readonly number[], depart = debut) => valeurs.map((value, i) => ({ time: depart + i * JOUR, value }));

describe("fluxNetQuotidien", () => {
  it("soustrait les sorties des entrées au même jour et ignore un jour présent d'un seul côté", () => {
    const entrees = serie([10, 20, 30]);
    const sorties = [{ time: debut, value: 4 }, { time: debut + 2 * JOUR, value: 50 }, { time: debut + 3 * JOUR, value: 1 }];
    expect(fluxNetQuotidien(entrees, sorties)).toEqual([
      { time: debut, value: 6 },
      { time: debut + 2 * JOUR, value: -20 },
    ]);
  });
});

describe("sommeJours", () => {
  it("additionne les derniers jours consécutifs finissant au dernier point", () => {
    expect(sommeJours(serie([1, 2, 3, 4]), 3)).toBe(9);
    expect(sommeJours(serie([1, 2, 3, 4]), 1)).toBe(4);
  });

  it("refuse une fenêtre trouée ou trop courte (jamais un zéro inventé)", () => {
    const trouee = [{ time: debut, value: 1 }, { time: debut + 2 * JOUR, value: 2 }, { time: debut + 3 * JOUR, value: 3 }];
    expect(sommeJours(trouee, 3)).toBeNull();
    expect(sommeJours(serie([1, 2]), 3)).toBeNull();
  });
});

describe("zScoreSommeGlissante", () => {
  it("729 jours à 0 puis 30 jours à −100 : z calculé à la main", () => {
    // Σ30 glissants sur 730 fins (jour courant inclus) : 700 fois 0, puis −100·k pour k = 1..30.
    // Moyenne = −100 × 465 / 730 = −63,6986 ; E[x²] = 10 000 × 9 455 / 730 = 129 520,55 ;
    // écart-type population = √(129 520,55 − 4 057,51) = 354,2076 ; z = (−3 000 + 63,6986) / 354,2076.
    const net = serie([...Array(729).fill(0), ...Array(30).fill(-100)]);
    expect(zScoreSommeGlissante(net)).toBeCloseTo(-8.289775, 5);
  });

  it("fenêtre 7 j sur 365 j acceptée", () => {
    // 364 jours à 0 puis 7 à −100 : moyenne −7,6712, écart-type 61,4554, z = −11,2655.
    const net = serie([...Array(364).fill(0), ...Array(7).fill(-100)]);
    expect(zScoreSommeGlissante(net, 7, 365)).toBeCloseTo(-11.265545, 5);
  });

  it("null sur série constante (écart-type nul), historique incomplet ou trou", () => {
    expect(zScoreSommeGlissante(serie(Array(759).fill(5)))).toBeNull();
    expect(zScoreSommeGlissante(serie([...Array(728).fill(0), ...Array(30).fill(-100)]))).toBeNull();
    const trouee = serie([...Array(729).fill(0), ...Array(31).fill(-100)]).filter((_, i) => i !== 400);
    expect(zScoreSommeGlissante(trouee)).toBeNull();
  });
});

describe("dernierStatutCm", () => {
  it("lit le dernier statut non nul de la métrique, null si la colonne est absente", () => {
    const lignes = [
      { time: "2026-09-12T00:00:00Z", "FlowInExNtv-status": "reviewed" },
      { time: "2026-09-13T00:00:00Z", "FlowInExNtv-status": "flash" },
      { time: "2026-09-14T00:00:00Z", "FlowInExNtv-status": null },
    ];
    expect(dernierStatutCm(lignes, "FlowInExNtv")).toBe("flash");
    expect(dernierStatutCm(lignes, "SplyExNtv")).toBeNull();
    expect(dernierStatutCm([], "FlowInExNtv")).toBeNull();
  });
});

describe("resumerFluxNet", () => {
  it("résume 1/7/30 j en natif et en USD, z30 et date d'observation", () => {
    const valeurs = Array.from({ length: 759 }, (_, i) => (i % 7) - 3);
    const net = serie(valeurs);
    const usd = serie(valeurs.map((v) => v * 60_000));
    const r = resumerFluxNet(net, usd);
    const somme = (n: number) => valeurs.slice(-n).reduce((s, v) => s + v, 0);
    expect(r).toMatchObject({ j1: somme(1), j7: somme(7), j30: somme(30), observeLe: net.at(-1)!.time });
    expect(r.usdJ1).toBe(somme(1) * 60_000);
    expect(r.usdJ7).toBe(somme(7) * 60_000);
    expect(r.usdJ30).toBe(somme(30) * 60_000);
    expect(r.z30).toBe(zScoreSommeGlissante(net));
  });

  it("USD absent ou décalé d'un jour : sommes USD nulles, natif conservé", () => {
    const net = serie([1, 2, 3]);
    expect(resumerFluxNet(net)).toMatchObject({ j1: 3, usdJ1: null, usdJ7: null, z30: null });
    expect(resumerFluxNet(net, serie([10, 20]))).toMatchObject({ j1: 3, usdJ1: null });
  });

  it("série vide : tout est null", () => {
    expect(resumerFluxNet([])).toEqual({ j1: null, j7: null, j30: null, usdJ1: null, usdJ7: null, usdJ30: null, z30: null, observeLe: null });
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

const NOW = Date.UTC(2026, 8, 14, 12);
const CLE = "axiom:onchain:cm:btc:flux-exchanges";

/** 800 lignes BTC quotidiennes finissant à J-1, valeurs en chaînes, statut flash. */
function lignesBtc(): unknown[] {
  const dernier = Date.UTC(2026, 8, 13);
  return Array.from({ length: 800 }, (_, i) => {
    const time = dernier - (799 - i) * JOUR;
    const entree = 10_000 + (i % 7) * 100;
    const sortie = 10_200;
    return {
      asset: "btc",
      time: new Date(time).toISOString(),
      FlowInExNtv: String(entree),
      "FlowInExNtv-status": "flash",
      FlowOutExNtv: String(sortie),
      "FlowOutExNtv-status": "flash",
      FlowInExUSD: String(entree * 60_000),
      FlowOutExUSD: String(sortie * 60_000),
    };
  });
}

describe("chargerFluxExchangesBtc : transport, cache 6 h, coalescence et repli", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", stockage());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("demande 4 métriques BTC sur 800 j, calcule le flux net et met en cache la série dérivée", async () => {
    const { chargerFluxExchangesBtc } = await import("./fluxExchangesCm");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: lignesBtc() }));
    vi.stubGlobal("fetch", fetcher);
    const r = await chargerFluxExchangesBtc({ now: () => NOW });
    const url = String(fetcher.mock.calls[0]?.[0]);
    expect(url).toContain("assets=btc");
    expect(url).toContain("metrics=FlowInExNtv%2CFlowOutExNtv%2CFlowInExUSD%2CFlowOutExUSD");
    expect(url).toContain("page_size=10000");
    expect(url).toContain("start_time=2024-07-06");
    expect(r).toMatchObject({ flash: true, disponible: true, perime: false });
    expect(r.repli).toBeUndefined();
    expect(r.points).toHaveLength(800);
    expect(r.points.at(-1)).toEqual({ time: Date.UTC(2026, 8, 13), value: 10_000 + (799 % 7) * 100 - 10_200 });
    expect(r.pointsUsd.at(-1)?.value).toBe((10_000 + (799 % 7) * 100 - 10_200) * 60_000);
    const brut = localStorage.getItem(CLE);
    expect(brut).not.toBeNull();
    expect(JSON.parse(brut!).donnee.points).toHaveLength(800);

    const relu = await chargerFluxExchangesBtc({ now: () => NOW });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(relu.points).toHaveLength(800);
    expect(relu.flash).toBe(true);
  });

  it("deux consommateurs simultanés partagent un seul téléchargement", async () => {
    const { chargerFluxExchangesBtc } = await import("./fluxExchangesCm");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: lignesBtc() }));
    vi.stubGlobal("fetch", fetcher);
    const [a, b] = await Promise.all([chargerFluxExchangesBtc({ now: () => NOW }), chargerFluxExchangesBtc({ now: () => NOW })]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a.points).toHaveLength(800);
    expect(b.points).toHaveLength(800);
  });

  it("HTTP 500 sans cache : indisponible, sans exception ni série inventée", async () => {
    const { chargerFluxExchangesBtc } = await import("./fluxExchangesCm");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    const r = await chargerFluxExchangesBtc({ now: () => NOW });
    expect(r).toMatchObject({ disponible: false, perime: false, points: [], pointsUsd: [], flash: false, recupereLe: NOW });
    expect(r.raison).toContain("500");
  });

  it("réponse sans flux : erreur « vide », pas de zéro", async () => {
    const { chargerFluxExchangesBtc } = await import("./fluxExchangesCm");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [{ asset: "btc", time: "2026-09-13T00:00:00Z", CapMVRVCur: "1.5" }] })));
    const r = await chargerFluxExchangesBtc({ now: () => NOW });
    expect(r).toMatchObject({ disponible: false, points: [] });
    expect(r.raison).toContain("vide");
  });

  it("cache expiré puis échec : cache resservi, périmé et marqué repli", async () => {
    const { chargerFluxExchangesBtc } = await import("./fluxExchangesCm");
    const point = { time: Date.UTC(2026, 8, 1), value: -5 };
    localStorage.setItem(CLE, JSON.stringify({ ts: 1_000, donnee: { points: [point], pointsUsd: [], flash: true } }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    const r = await chargerFluxExchangesBtc({ now: () => NOW });
    expect(r).toMatchObject({ points: [point], flash: true, disponible: true, perime: true, repli: true, recupereLe: 1_000 });
    expect(r.raison).toMatch(/^Cache périmé · .*503/);
  });
});
