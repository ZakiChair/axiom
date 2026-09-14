/**
 * OI des perps DEX (DefiLlama `/overview/open-interest`, ventilation par protocole).
 *
 * Référence réelle (charge sondée le 2026-09-14 à 22:39 UTC, point du jour encore en
 * cours d'actualisation, 80 protocoles) : catégorie Derivatives ≈ 23,18 Md$ ; Δ7j −2,96 %
 * à périmètre constant (−2,94 % brut, 0,02 % du total exclu) ; Δ30j +22,98 % à périmètre
 * constant contre +27,09 % brut (3,25 % du total exclu, surtout edgeX V2 apparu le
 * 2026-08-16) ; part d'Hyperliquid Perps ≈ 59,6 % ; record 26 552 157 325 $ le 2025-10-05,
 * hors des 120 points affichés. Les fixtures ci-dessous sont synthétiques.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOM_HYPERLIQUID, observationPerimee, parseOiPerpsDex, variationPerimetreConstant } from "./oiPerpsDex";

const JOUR_S = 86_400;
/** 00:00 UTC. */
const T0 = 1_780_000_000 - (1_780_000_000 % JOUR_S);

const PROTOCOLES = [
  { name: "Hyperliquid Perps", category: "Derivatives" },
  { name: "Aster Perps", category: "Derivatives" },
  { name: "Kalshi", category: "Prediction Market" },
  { name: "Boros", category: "Interest Rate Derivatives" },
  { name: "tradeXYZ", category: "Interface" },
];

type Ligne = [number, Record<string, number>];

function ventilation(jours: number, valeurs: (i: number) => Record<string, number>): Ligne[] {
  return Array.from({ length: jours }, (_, i): Ligne => [T0 + i * JOUR_S, valeurs(i)]);
}

/** Hyperliquid 600 + i, Aster 400, plus des catégories et une clé inconnue à exclure. */
const standard = (i: number) => ({
  [NOM_HYPERLIQUID]: 600 + i,
  "Aster Perps": 400,
  Kalshi: 1_000_000,
  Boros: 500_000,
  Fantome: 70_000_000,
});

const niveau = (i: number) => 1000 + i;
const ms = (i: number) => (T0 + i * JOUR_S) * 1000;

describe("parseOiPerpsDex", () => {
  it("ne somme que la catégorie Derivatives (marchés prédictifs, taux, clés inconnues exclus)", () => {
    const r = parseOiPerpsDex({ protocols: PROTOCOLES, totalDataChartBreakdown: ventilation(40, standard) });
    expect(r?.niveau).toBe(niveau(39));
    expect(r?.observation).toBe(ms(39));
    expect(r?.serie[0]).toEqual({ time: ms(0), value: niveau(0) });
  });

  it("Δ7j et Δ30j par timestamp, sur la série complète", () => {
    const r = parseOiPerpsDex({ protocols: PROTOCOLES, totalDataChartBreakdown: ventilation(40, standard) });
    expect(r?.delta7jPct).toBeCloseTo((niveau(39) / niveau(32) - 1) * 100, 10);
    expect(r?.delta30jPct).toBeCloseTo((niveau(39) / niveau(9) - 1) * 100, 10);
    expect(r?.exclu7jPct).toBe(0);
    expect(r?.exclu30jPct).toBe(0);
  });

  it("Δ à périmètre constant : protocoles apparus ou disparus exclus des deux dates ; niveau et part au périmètre courant", () => {
    const protocoles = [
      ...PROTOCOLES,
      { name: "edgeX V2", category: "Derivatives" },
      { name: "edgeX Perps", category: "Derivatives" },
    ];
    // edgeX V2 apparaît au jour 20 (300), edgeX Perps disparaît après le jour 15 (200).
    const migration = (i: number) => ({
      ...standard(i),
      ...(i >= 20 ? { "edgeX V2": 300 } : {}),
      ...(i <= 15 ? { "edgeX Perps": 200 } : {}),
    });
    const r = parseOiPerpsDex({ protocols: protocoles, totalDataChartBreakdown: ventilation(40, migration) });
    expect(r?.niveau).toBe(niveau(39) + 300);
    expect(r?.partHyperliquidPct).toBeCloseTo((639 / 1339) * 100, 10);
    // J-30 (jour 9) : edgeX V2 absent, edgeX Perps présent → les deux exclus.
    expect(r?.delta30jPct).toBeCloseTo((niveau(39) / niveau(9) - 1) * 100, 10);
    expect(r?.exclu30jPct).toBeCloseTo((300 / 1339) * 100, 10);
    // J-7 (jour 32) : edgeX V2 présent aux deux dates → compté.
    expect(r?.delta7jPct).toBeCloseTo((1339 / 1332 - 1) * 100, 10);
    expect(r?.exclu7jPct).toBe(0);
    // Le record reste au périmètre courant de chaque jour.
    expect(r?.record).toEqual({ valeur: 1339, time: ms(39) });
  });

  it("Δ null si l'historique est trop court ou si le jour de base manque (jamais d'index décalé)", () => {
    const court = parseOiPerpsDex({ protocols: PROTOCOLES, totalDataChartBreakdown: ventilation(20, standard) });
    expect(court?.delta7jPct).not.toBeNull();
    expect(court?.delta30jPct).toBeNull();
    expect(court?.exclu30jPct).toBeNull();
    const tresCourt = parseOiPerpsDex({ protocols: PROTOCOLES, totalDataChartBreakdown: ventilation(5, standard) });
    expect(tresCourt?.delta7jPct).toBeNull();
    const trou = ventilation(40, standard).filter(([ts]) => ts !== T0 + 32 * JOUR_S);
    const r = parseOiPerpsDex({ protocols: PROTOCOLES, totalDataChartBreakdown: trou });
    expect(r?.delta7jPct).toBeNull();
    expect(r?.delta30jPct).not.toBeNull();
  });

  it("un jour sans aucune valeur Derivatives est absent, jamais compté à zéro", () => {
    const lignes = ventilation(40, standard);
    lignes[32] = [T0 + 32 * JOUR_S, { Kalshi: 5, Fantome: 9 }];
    const r = parseOiPerpsDex({ protocols: PROTOCOLES, totalDataChartBreakdown: lignes });
    expect(r?.serie).toHaveLength(39);
    expect(r?.serie.some((p) => p.value === 0)).toBe(false);
    expect(r?.delta7jPct).toBeNull();
  });

  it("record = maximum de la catégorie avec sa date (premier en cas d'égalité)", () => {
    const pic = (i: number) => ({ ...standard(i), [NOM_HYPERLIQUID]: i === 20 || i === 25 ? 5000 : 600 + i });
    const r = parseOiPerpsDex({ protocols: PROTOCOLES, totalDataChartBreakdown: ventilation(40, pic) });
    expect(r?.record).toEqual({ valeur: 5400, time: ms(20) });
  });

  it("part d'Hyperliquid au dernier point ; absente ou hors catégorie → null, pas 0", () => {
    const r = parseOiPerpsDex({ protocols: PROTOCOLES, totalDataChartBreakdown: ventilation(40, standard) });
    expect(r?.partHyperliquidPct).toBeCloseTo((639 / 1039) * 100, 10);

    const sansHl = ventilation(40, standard);
    sansHl[39] = [T0 + 39 * JOUR_S, { "Aster Perps": 400 }];
    const r2 = parseOiPerpsDex({ protocols: PROTOCOLES, totalDataChartBreakdown: sansHl });
    expect(r2?.niveau).toBe(400);
    expect(r2?.partHyperliquidPct).toBeNull();

    const renomme = PROTOCOLES.map((p) => (p.name === NOM_HYPERLIQUID ? { ...p, category: "Interface" } : p));
    const r3 = parseOiPerpsDex({ protocols: renomme, totalDataChartBreakdown: ventilation(40, standard) });
    expect(r3?.niveau).toBe(400);
    expect(r3?.partHyperliquidPct).toBeNull();
  });

  it("formes invalides : null ; lignes malformées ignorées ; ordre des lignes indifférent", () => {
    expect(parseOiPerpsDex(null)).toBeNull();
    expect(parseOiPerpsDex({ totalDataChartBreakdown: ventilation(40, standard) })).toBeNull();
    expect(parseOiPerpsDex({ protocols: PROTOCOLES, totalDataChartBreakdown: "rien" })).toBeNull();
    expect(parseOiPerpsDex({ protocols: PROTOCOLES, totalDataChartBreakdown: [] })).toBeNull();
    const zero = ventilation(40, standard);
    zero[39] = [T0 + 39 * JOUR_S, { [NOM_HYPERLIQUID]: 0, "Aster Perps": 0 }];
    expect(parseOiPerpsDex({ protocols: PROTOCOLES, totalDataChartBreakdown: zero })).toBeNull();

    const reference = parseOiPerpsDex({ protocols: PROTOCOLES, totalDataChartBreakdown: ventilation(40, standard) });
    const bruit: unknown[] = [...ventilation(40, standard)].reverse();
    bruit.push("x", ["1780000000", {}], [T0, null], null);
    expect(parseOiPerpsDex({ protocols: PROTOCOLES, totalDataChartBreakdown: bruit })).toEqual(reference);
  });

  it("série tronquée aux 120 derniers points, temps en ms", () => {
    const r = parseOiPerpsDex({ protocols: PROTOCOLES, totalDataChartBreakdown: ventilation(200, standard) });
    expect(r?.serie).toHaveLength(120);
    expect(r?.serie[0]).toEqual({ time: ms(80), value: niveau(80) });
    expect(r?.serie.at(-1)).toEqual({ time: ms(199), value: niveau(199) });
  });

  it("record et variations calculés AVANT la troncature : un pic hors des 120 points est conservé", () => {
    const pic = (i: number) => ({ ...standard(i), [NOM_HYPERLIQUID]: i === 10 ? 9000 : 600 + i });
    const r = parseOiPerpsDex({ protocols: PROTOCOLES, totalDataChartBreakdown: ventilation(200, pic) });
    expect(r?.record).toEqual({ valeur: 9400, time: ms(10) });
    expect(r?.serie.some((p) => p.time === ms(10))).toBe(false);
    expect(r?.delta30jPct).toBeCloseTo((niveau(199) / niveau(169) - 1) * 100, 10);
  });
});

describe("variationPerimetreConstant", () => {
  it("seuls les protocoles présents aux deux dates ; part du total courant exclue", () => {
    const r = variationPerimetreConstant({ A: 5, B: 2 }, { A: 4, C: 10 });
    expect(r?.pct).toBeCloseTo(25, 10);
    expect(r?.excluPct).toBeCloseTo((2 / 7) * 100, 10);
    // Valeur 0 à la base : protocole présent (valeur finie), compté.
    expect(variationPerimetreConstant({ A: 5, B: 3 }, { A: 4, B: 0 })?.pct).toBeCloseTo(100, 10);
  });

  it("base absente ou somme commune non positive : null", () => {
    expect(variationPerimetreConstant({ A: 5 }, undefined)).toBeNull();
    expect(variationPerimetreConstant({ A: 5 }, { B: 4 })).toBeNull();
    expect(variationPerimetreConstant({ A: 5 }, { A: 0 })).toBeNull();
  });
});

describe("observationPerimee", () => {
  const H = 3_600_000;
  it("périmée au-delà de 2 jours seulement", () => {
    expect(observationPerimee(0, 47 * H)).toBe(false);
    expect(observationPerimee(0, 48 * H)).toBe(false);
    expect(observationPerimee(0, 49 * H)).toBe(true);
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

describe("fetchOiPerpsDex : ventilation, cache dérivé 1 h, dégradation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", stockage());
    // Horloge 10 h après le dernier point des fixtures (observation fraîche).
    vi.setSystemTime(ms(39) + 10 * 3_600_000);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("demande la ventilation par protocole, met en cache le résultat dérivé seulement", async () => {
    const { fetchOiPerpsDex } = await import("./oiPerpsDex");
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ protocols: PROTOCOLES, totalDataChartBreakdown: ventilation(40, standard), totalDataChart: [] }),
    );
    vi.stubGlobal("fetch", fetcher);
    const r = await fetchOiPerpsDex();
    expect(r?.perime).toBe(false);
    expect(r?.donnee.niveau).toBe(niveau(39));
    const url = String(fetcher.mock.calls[0]?.[0]);
    expect(url).toContain("api.llama.fi/overview/open-interest");
    expect(url).toContain("excludeTotalDataChart=true");
    expect(url).not.toContain("excludeTotalDataChartBreakdown");

    const brut = localStorage.getItem("axiom:onchain:dex:oi-perps:v2");
    expect(brut).not.toBeNull();
    expect(brut).not.toContain("totalDataChartBreakdown");
    expect(brut).not.toContain("Kalshi");
    expect(Object.keys((JSON.parse(brut!) as { donnee: object }).donnee).sort()).toEqual(
      ["delta30jPct", "delta7jPct", "exclu30jPct", "exclu7jPct", "niveau", "observation", "partHyperliquidPct", "record", "serie"],
    );

    const r2 = await fetchOiPerpsDex();
    expect(r2?.donnee).toEqual(r?.donnee);
    expect(r2?.perime).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("observation de plus de 2 jours : périmée, au réseau comme au cache frais", async () => {
    const { fetchOiPerpsDex } = await import("./oiPerpsDex");
    vi.setSystemTime(ms(39) + 49 * 3_600_000);
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ protocols: PROTOCOLES, totalDataChartBreakdown: ventilation(40, standard) }),
    );
    vi.stubGlobal("fetch", fetcher);
    const r = await fetchOiPerpsDex();
    expect(r?.perime).toBe(true);
    expect(r?.donnee.niveau).toBe(niveau(39));
    const r2 = await fetchOiPerpsDex();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(r2?.perime).toBe(true);
  });

  it("HTTP 503 ou charge inexploitable : null sans écrire de cache", async () => {
    const { fetchOiPerpsDex } = await import("./oiPerpsDex");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    expect(await fetchOiPerpsDex()).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ totalDataChart: [] })));
    expect(await fetchOiPerpsDex()).toBeNull();
    expect(localStorage.getItem("axiom:onchain:dex:oi-perps:v2")).toBeNull();
  });

  it("source en échec : le cache périmé est resservi, étiqueté périmé", async () => {
    const { fetchOiPerpsDex } = await import("./oiPerpsDex");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    const donnee = {
      niveau: 2,
      observation: 1,
      delta7jPct: null,
      delta30jPct: null,
      exclu7jPct: null,
      exclu30jPct: null,
      partHyperliquidPct: null,
      record: { valeur: 3, time: 1 },
      serie: [],
    };
    localStorage.setItem("axiom:onchain:dex:oi-perps:v2", JSON.stringify({ donnee, ts: 0 }));
    const r = await fetchOiPerpsDex();
    expect(r?.perime).toBe(true);
    expect(r?.donnee).toEqual(donnee);
  });
});
