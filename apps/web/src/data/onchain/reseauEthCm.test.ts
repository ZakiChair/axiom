/**
 * Réseau ETH via Coin Metrics community : réserve et flux exchanges, émission nette, prix réalisé.
 *
 * Oracles réels relus le 2026-09-14 (ETH, dernier point 2026-09-13) : réserve 15 451 535 ETH
 * (12,66 % de l'offre) ; flux net 1/7/30 j = −11 744 / −42 675 / −362 193 ETH, z30 −0,05 ;
 * émission nette 7/30/365 j = +0,874 / +0,867 / +0,813 %/an ; frais totaux 30 j 5 174,6 ETH ;
 * prix réalisé 2 263,72 $ pour un spot CM de 2 475,49 $ (+9,35 %), MVRV 1,0935. Marches de
 * périmètre : +201 464 ETH le 2026-05-13 (dans l'horizon 365 j, hors 90 j).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoinMetricsParse } from "./coinmetrics";
import { resumerFluxNet } from "./fluxExchangesCm";
import {
  calculerReseauEthCm,
  emissionNetteAnnualisee,
  prixRealiseEth,
  variationReserve,
} from "./reseauEthCm";

const JOUR = 86_400_000;
const FIN = Date.UTC(2026, 8, 13);
/** Série quotidienne finissant à FIN (le dernier élément est le jour FIN). */
const serie = (valeurs: readonly number[], fin = FIN) =>
  valeurs.map((value, i) => ({ time: fin - (valeurs.length - 1 - i) * JOUR, value }));

describe("emissionNetteAnnualisee", () => {
  it("offre de 100 000 à 100 082,19 sur 30 j : ≈ +1,000 %/an", () => {
    const offre = serie([100_000, ...Array(29).fill(100_050), 100_082.19]);
    expect(emissionNetteAnnualisee(offre, 30)).toBeCloseTo(1.0, 3);
  });

  it("point de référence manquant : null, jamais une valeur inventée", () => {
    expect(emissionNetteAnnualisee(serie([100, 101]), 30)).toBeNull();
    expect(emissionNetteAnnualisee([], 7)).toBeNull();
  });
});

describe("variationReserve", () => {
  // 400 jours : flux net −10/j et réserve cohérente, puis une marche de +5 000 ETH à J−100.
  const net = serie(Array(400).fill(-10));
  const reserve = serie(Array.from({ length: 400 }, (_, i) => 1_000_000 - 10 * i + (i >= 299 ? 5_000 : 0)));

  it("30 j sans marche : variation et écart nul, drapeau baissé", () => {
    const v = variationReserve(reserve, net, 30);
    expect(v).toMatchObject({ jours: 30, absolue: -300, ecartPerimetre: 0, marche: false });
    expect(v.pct).toBeCloseTo((-300 / reserve.at(-31)!.value) * 100, 10);
  });

  it("365 j traversant la marche de +5 000 (> 0,5 % du stock en un jour) : drapeau levé", () => {
    const v = variationReserve(reserve, net, 365);
    expect(v.marche).toBe(true);
    expect(v.ecartPerimetre).toBeCloseTo(5_000, 6);
    expect(v.absolue).toBeCloseTo(-3_650 + 5_000, 6);
  });

  it("dérive lente cumulée mais aucune marche d'un jour : drapeau baissé", () => {
    // +300 ETH/j de dérive sur un stock d'un million : 0,03 %/j, jamais > 0,5 % en un jour.
    const derive = serie(Array.from({ length: 100 }, (_, i) => 1_000_000 + 290 * i));
    const v = variationReserve(derive, serie(Array(100).fill(-10)), 90);
    expect(v.ecartPerimetre).toBeCloseTo(27_000, 6);
    expect(v.marche).toBe(false);
  });

  it("jour manquant dans l'horizon ou flux décalé : contrôle impossible (null), variation conservée", () => {
    const trouee = reserve.filter((_, i) => i !== 390);
    const v = variationReserve(trouee, net, 30);
    expect(v.marche).toBeNull();
    expect(v.absolue).toBe(-300);
    const decale = variationReserve(reserve, net.slice(0, -1), 30);
    expect(decale).toMatchObject({ absolue: -300, ecartPerimetre: null, marche: null });
  });

  it("historique trop court : tout null", () => {
    expect(variationReserve(serie([1, 2, 3]), serie([1, 1, 1]), 365))
      .toEqual({ jours: 365, absolue: null, pct: null, ecartPerimetre: null, marche: null });
  });
});

describe("prixRealiseEth", () => {
  it("cap 2 000 000, MVRV 1,1, offre 1 000 : prix réalisé 1 818,18 $, spot 2 000 $, écart +10 %", () => {
    const r = prixRealiseEth(serie([2_000_000]), serie([1.1]), serie([1_000]));
    expect(r.prixRealiseUsd).toBeCloseTo(1_818.1818, 3);
    expect(r.spotCmUsd).toBe(2_000);
    expect(r.ecartSpotPct).toBeCloseTo(10, 10);
    expect(r.mvrv).toBe(1.1);
    expect(r.observeLe).toBe(FIN);
  });

  it("jours non alignés : prend le dernier jour commun aux trois séries", () => {
    const cap = serie([1_000_000, 2_000_000, 3_000_000]);
    const mvrv = serie([1.25, 2], FIN - JOUR);
    const offre = serie([1_000, 1_000, 1_000, 1_000], FIN + JOUR);
    const r = prixRealiseEth(cap, mvrv, offre);
    expect(r.observeLe).toBe(FIN - JOUR);
    expect(r.prixRealiseUsd).toBeCloseTo(2_000_000 / 2 / 1_000, 10);
  });

  it("MVRV à 0 ou absent : null", () => {
    const vide = { prixRealiseUsd: null, spotCmUsd: null, ecartSpotPct: null, mvrv: null, observeLe: null };
    expect(prixRealiseEth(serie([2_000_000]), serie([0]), serie([1_000]))).toEqual(vide);
    expect(prixRealiseEth(serie([2_000_000]), [], serie([1_000]))).toEqual(vide);
  });
});

/** Séries parsées synthétiques de `n` jours (valeurs choisies pour des résultats calculables). */
function seriesSynthetiques(n = 800): CoinMetricsParse {
  const s = (f: (i: number) => number) => {
    const points = serie(Array.from({ length: n }, (_, i) => f(i)));
    return { points, dernier: points.at(-1) };
  };
  return {
    CapMrktCurUSD: s(() => 302_112_948_927.53),
    CapMVRVCur: s(() => 1.093547895553365),
    SplyCur: s((i) => 120_000_000 + 2_900 * i),
    SplyExNtv: s((i) => 18_000_000 - 1_000 * i),
    FlowInExNtv: s((i) => 100_000 + (i % 5)),
    FlowOutExNtv: s((i) => 101_000 + (i % 5)),
    FeeTotNtv: s(() => 170),
  };
}

describe("calculerReseauEthCm", () => {
  it("assemble réserve, flux, émission et prix réalisé ; propage le statut flash", () => {
    const series = seriesSynthetiques();
    const r = calculerReseauEthCm(series, true);
    expect(r.flash).toBe(true);
    const stock = 18_000_000 - 1_000 * 799;
    expect(r.reserve).toMatchObject({ stockEth: stock, observeLe: FIN });
    expect(r.reserve!.partOffrePct).toBeCloseTo((100 * stock) / (120_000_000 + 2_900 * 799), 10);
    expect(r.reserve!.variations.map((v) => [v.jours, v.absolue, v.marche])).toEqual([
      [30, -30_000, false], [90, -90_000, false], [365, -365_000, false],
    ]);
    expect(r.fluxNet).toHaveLength(800);
    expect(resumerFluxNet(r.fluxNet).j30).toBe(-30_000);
    expect(r.emission.pctAn30).toBeCloseTo(((2_900 * 30) / (120_000_000 + 2_900 * 769)) * (365 / 30) * 100, 10);
    expect(r.emission.pctAn7).not.toBeNull();
    expect(r.emission.pctAn365).not.toBeNull();
    expect(r.emission.fraisTotaux30Eth).toBe(5_100);
    // Oracle réel : cap 302 112 948 927,53 $ ÷ MVRV 1,093548 ÷ offre 122 041 617,23 → 2 263,72 $ ;
    // l'écart au spot du même jour vaut MVRV − 1 par construction (+9,35 %).
    const offre = 120_000_000 + 2_900 * 799;
    expect(r.prixRealise.prixRealiseUsd).toBeCloseTo(302_112_948_927.53 / 1.093547895553365 / offre, 6);
    expect(r.prixRealise.spotCmUsd).toBeCloseTo(302_112_948_927.53 / offre, 6);
    expect(r.prixRealise.mvrv).toBeCloseTo(1.0935, 4);
    expect(r.prixRealise.ecartSpotPct).toBeCloseTo(9.3548, 3);
    expect(302_112_948_927.53 / 1.093547895553365 / 122_041_617.227).toBeCloseTo(2_263.72, 2);
    expect(r.derniereObservation).toBe(FIN);
  });

  it("dernière observation = la plus ancienne des blocs disponibles (un bloc frais ne masque pas un bloc en retard)", () => {
    const series = seriesSynthetiques();
    series.CapMVRVCur = { points: series.CapMVRVCur!.points.slice(0, -3) };
    const r = calculerReseauEthCm(series, false);
    expect(r.prixRealise.observeLe).toBe(FIN - 3 * JOUR);
    expect(r.derniereObservation).toBe(FIN - 3 * JOUR);
  });

  it("frais totaux : null si la série de frais ne finit pas le jour de l'offre", () => {
    const series = seriesSynthetiques();
    series.FeeTotNtv = { points: series.FeeTotNtv!.points.slice(0, -1) };
    expect(calculerReseauEthCm(series, false).emission.fraisTotaux30Eth).toBeNull();
  });

  it("part de l'offre : null si l'offre manque le jour du stock", () => {
    const series = seriesSynthetiques();
    series.SplyCur = { points: series.SplyCur!.points.slice(0, -1) };
    const r = calculerReseauEthCm(series, false);
    expect(r.reserve?.stockEth).toBe(18_000_000 - 1_000 * 799);
    expect(r.reserve?.partOffrePct).toBeNull();
  });

  it("séries vides : aucun bloc, aucun zéro inventé", () => {
    const r = calculerReseauEthCm({}, false);
    expect(r).toMatchObject({ reserve: null, fluxNet: [], flash: false, derniereObservation: null });
    expect(r.emission).toEqual({ pctAn7: null, pctAn30: null, pctAn365: null, fraisTotaux30Eth: null, observeLe: null });
    expect(r.prixRealise.prixRealiseUsd).toBeNull();
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
const CLE = "axiom:onchain:cm:eth:reseau";

/** 800 lignes ETH brutes (7 métriques en chaînes, horodatage nanoseconde, statut flash). */
function lignesEth(): unknown[] {
  return Array.from({ length: 800 }, (_, i) => ({
    asset: "eth",
    time: `${new Date(FIN - (799 - i) * JOUR).toISOString().slice(0, 10)}T00:00:00.000000000Z`,
    CapMrktCurUSD: "302112948927.53",
    CapMVRVCur: "1.093547895553364955",
    SplyCur: String(120_000_000 + 2_900 * i),
    SplyExNtv: String(18_000_000 - 1_000 * i),
    "SplyExNtv-status": "flash",
    FlowInExNtv: String(100_000),
    "FlowInExNtv-status": "flash",
    FlowOutExNtv: String(101_000),
    "FlowOutExNtv-status": "flash",
    FeeTotNtv: "170",
  }));
}

describe("fetchReseauEthCm : un seul fetch ETH, cache 6 h, dégradation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.stubGlobal("localStorage", stockage());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("demande les 7 métriques ETH sur 800 j en une requête et met en cache la donnée dérivée", async () => {
    const { fetchReseauEthCm } = await import("./reseauEthCm");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: lignesEth() }));
    vi.stubGlobal("fetch", fetcher);
    const r = await fetchReseauEthCm();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const url = String(fetcher.mock.calls[0]?.[0]);
    expect(url).toContain("assets=eth");
    expect(url).toContain("metrics=CapMrktCurUSD%2CCapMVRVCur%2CSplyCur%2CSplyExNtv%2CFlowInExNtv%2CFlowOutExNtv%2CFeeTotNtv");
    expect(url).toContain("page_size=10000");
    expect(url).toContain("start_time=2024-07-06");
    expect(r).toMatchObject({ perime: false, ts: NOW });
    expect(r?.donnee.flash).toBe(true);
    expect(r?.donnee.reserve?.stockEth).toBe(18_000_000 - 1_000 * 799);
    expect(r?.donnee.fluxNet).toHaveLength(800);
    const brut = localStorage.getItem(CLE);
    expect(brut).not.toBeNull();
    expect(JSON.parse(brut!).donnee.fluxNet).toHaveLength(800);

    const relu = await fetchReseauEthCm();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(relu?.donnee.reserve?.stockEth).toBe(r?.donnee.reserve?.stockEth);
  });

  it("HTTP 503 sans cache : null ; réponse sans métrique ETH : null (« vide »)", async () => {
    const { fetchReseauEthCm } = await import("./reseauEthCm");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    expect(await fetchReseauEthCm()).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [{ asset: "btc", time: "2026-09-13T00:00:00Z", CapMVRVCur: "1.5" }] })));
    expect(await fetchReseauEthCm()).toBeNull();
    expect(localStorage.getItem(CLE)).toBeNull();
  });

  it("cache expiré puis échec : cache resservi et marqué périmé", async () => {
    const { fetchReseauEthCm, calculerReseauEthCm: calculer } = await import("./reseauEthCm");
    const donnee = calculer(seriesSynthetiques(40), true);
    localStorage.setItem(CLE, JSON.stringify({ ts: NOW - 7 * 3_600_000, donnee }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    const r = await fetchReseauEthCm();
    expect(r).toMatchObject({ perime: true, ts: NOW - 7 * 3_600_000 });
    expect(r?.donnee.reserve?.stockEth).toBe(donnee.reserve?.stockEth);
  });
});
