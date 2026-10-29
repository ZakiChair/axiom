/**
 * Dominance des stablecoins (STABLE.D) : calcul pur, requêtes CMC, cache journalier, bougies
 * et repoll. Le réseau est simulé par un `fetcher` injecté qui DISTINGUE l'id de la pièce
 * (825 USDT, 3408 USDC, 4943 DAI) : servir ETH pour tout id masquerait une erreur de jointure.
 *
 * Valeurs réelles : réponses CMC publiques enregistrées le 29/10/2026 entre 09:41 et 09:49 UTC
 * (detail/chart 1d par id, global-metrics 1d), réduites à quelques jours. Les valeurs attendues
 * ont été recalculées HORS d'AXIOM (script indépendant sur les réponses complètes) et comparées
 * à la vérité horaire : Σ capitalisations 1h de D 00:00 / TOTAL 1d de D.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Candle } from "@axiom/types";
import type { McapSnapshot } from "../store/macroHistory";
import {
  abonnerDominance,
  alignerJournalier,
  bougiesDominance,
  chargerStablesJournalieres,
  CLE_CACHE_STABLES,
  contributionPiece,
  dominanceSurTotal,
  IDS_STABLECOINS_CMC,
  LANCEMENTS_STABLECOINS_CMC,
  type PointBrut,
  type SeriePiece,
} from "./dominanceStablecoins";

const HEURE = 3_600_000;
const JOUR = 86_400_000;
const J26 = Date.UTC(2026, 9, 26);
const J27 = Date.UTC(2026, 9, 27);
const J28 = Date.UTC(2026, 9, 28);
const J29 = Date.UTC(2026, 9, 29);
/** Instant des mesures : le global publie déjà le 29/10 00:00, les pièces s'arrêtent au 28/10. */
const MAINTENANT = Date.UTC(2026, 9, 29, 9, 46);
const IDS = [825, 3408, 4943] as const;
type IdPiece = (typeof IDS)[number];

/**
 * Lignes 1d réelles de detail/chart (r01–r03), [prix v[0], capitalisation v[2]] des 26, 27 et
 * 28/10/2026. Le point daté D vaut prix(D 00:00) × offre(D 23:00) (mesuré : USDT et USDC
 * 584 jours sur 584) ; la ligne du 29/10 ne paraît qu'après le 29/10 23:00.
 */
const LIGNES_OCT_2026: Record<IdPiece, ReadonlyArray<readonly [number, number]>> = {
  825: [[0.9986756189948013, 182_255_744_463.1627], [0.9983375730383177, 182_184_804_115.7319], [0.9986550873117038, 181_559_686_290.5858]],
  3408: [[0.9998371209260404, 71_089_745_555.7866], [0.9997060239428396, 71_137_607_344.0206], [0.9996885595827637, 71_231_226_037.0081]],
  4943: [[0.999620540693476, 4_517_621_179.8636], [0.9995255611821315, 4_510_268_777.7047], [0.9996596731473171, 4_561_176_052.8433]],
};
/** TOTAL réel (global-metrics 1d, instantané de 00:00) : 27, 28 et 29/10/2026. */
const TOTAL_OCT_2026 = [2_679_522_849_435.56, 2_705_348_676_015.38, 2_718_204_851_783.97] as const;

/** Lignes 1d réelles des 30 et 31/03/2020 : l'offre d'USDT passe de 4,67 à 6,18 G$ entre 00:00 et 01:00 le 31. */
const LIGNES_MARS_2020: Record<IdPiece, ReadonlyArray<readonly [number, number]>> = {
  825: [[1.00172778215, 4_650_388_413.5517], [1.00577543762, 6_201_706_082.3534]],
  3408: [[0.977026379119, 672_329_974.0641], [1.00372913803, 689_484_135.8445]],
  4943: [[0.980710642307, 80_203_625.5116], [1.01691275386, 84_515_335.2546]],
};
const TOTAL_31_03_2020 = 179_004_620_408.42;

/** Ligne servie par le faux CMC : [instant, capitalisation, prix (0,9986 par défaut)]. */
type Ligne = readonly [t: number, cap: number, prix?: unknown];
type Serie = (debut: number, fin: number, intervalle: string) => Ligne[];

function reponse(json: unknown, status = 200): Response {
  return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
}

/** Forme réelle de detail/chart (r01, r15). */
function corpsChart(points: readonly Ligne[]) {
  return {
    data: {
      points: points.map(([t, cap, prix = 0.9986]) => ({ s: String(t / 1000), v: [prix, 54_575_540_599.35, cap], c: {} })),
      timeEnd: String((points[0]?.[0] ?? 0) / 1000 - 1),
      chartCacheTime: "100",
    },
    status: { timestamp: "2026-10-29T09:46:08.647Z", error_code: "0", error_message: "SUCCESS", elapsed: "10", credit_count: 0 },
  };
}

/** Forme réelle de global-metrics/quotes/historical (r05). */
function corpsGlobal(points: Array<[number, number]>) {
  return {
    data: {
      quotes: points.map(([t, total]) => ({
        timestamp: new Date(t).toISOString(),
        searchInterval: "1440",
        btcDominance: 58.7,
        ethDominance: 10.9,
        quote: [{ name: "2781", timestamp: new Date(t).toISOString(), totalMarketCap: total, altcoinMarketCap: total * 0.41 }],
      })),
    },
    status: { timestamp: "2026-10-29T09:45:00.000Z", error_code: "0", error_message: "SUCCESS", elapsed: "12", credit_count: 0 },
  };
}

/** Erreur CMC réelle servie en HTTP 200 (r14 : multi-id refusé ; r11 : limite de 2 200). */
const ERREUR_CMC = { status: { timestamp: "2026-10-29T09:49:00.506Z", error_code: "500", error_message: "The system is busy, please try again later!", elapsed: "0", credit_count: 0 } };

/** Points `[t, f(t)]` d'une grille alignée, bornes incluses. */
function grille(debut: number, fin: number, pas: number, f: (t: number) => number): Array<[number, number]> {
  const sortie: Array<[number, number]> = [];
  for (let t = Math.ceil(debut / pas) * pas; t <= fin; t += pas) sortie.push([t, f(t)]);
  return sortie;
}

/** Faux serveur CMC : route par chemin ET par id ; un id inconnu reçoit une erreur CMC. */
function serveur(options: { global: (debut: number, fin: number, intervalle: string) => Array<[number, number]>; pieces: Partial<Record<number, Serie>> }) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    expect(url.pathname.startsWith("/extapi/api.coinmarketcap.com/data-api/")).toBe(true);
    const debut = Number(url.searchParams.get("timeStart")) * 1000;
    const fin = Number(url.searchParams.get("timeEnd")) * 1000;
    const intervalle = url.searchParams.get("interval") ?? "";
    if (url.pathname.includes("global-metrics")) return reponse(corpsGlobal(options.global(debut, fin, intervalle)));
    const serie = options.pieces[Number(url.searchParams.get("id"))];
    return reponse(serie === undefined ? ERREUR_CMC : corpsChart(serie(debut, fin, intervalle)));
  });
  const appels = () => mock.mock.calls.map(([input]) => new URL(String(input), "http://localhost"));
  const appelsPiece = (id: number) => appels().filter((url) => url.searchParams.get("id") === String(id));
  return { fetcher: mock as unknown as typeof fetch, mock, appels, appelsPiece };
}

const secondes = (url: URL | undefined, champ: "timeStart" | "timeEnd") => Number(url?.searchParams.get(champ)) * 1000;

const LANCEMENTS_PAR_ID: Record<IdPiece, number> = {
  825: LANCEMENTS_STABLECOINS_CMC.USDT,
  3408: LANCEMENTS_STABLECOINS_CMC.USDC,
  4943: LANCEMENTS_STABLECOINS_CMC.DAI,
};

/** Pièce constante (USD) publiée à `pas`, du lancement jusqu'à `derniere` (retard de publication). */
function pieceConstante(id: IdPiece, cap: number, derniere = J28): Serie {
  return (debut, fin, intervalle) => {
    const pas = intervalle === "1h" ? HEURE : JOUR;
    return grille(Math.max(debut, LANCEMENTS_PAR_ID[id]), Math.min(fin, derniere), pas, () => cap);
  };
}

/** Trois pièces constantes : USDT 60 G$, USDC 30 G$, DAI 10 G$ → 10 % d'un TOTAL de 1 T$. */
function piecesDixPourcent(derniere = J28): Partial<Record<number, Serie>> {
  return {
    825: pieceConstante(825, 60e9, derniere),
    3408: pieceConstante(3408, 30e9, derniere),
    4943: pieceConstante(4943, 10e9, derniere),
  };
}

/** Lignes réelles servies jour après jour à partir de `debut` ([t, cap, prix]). */
function lignesServies(debut: number, valeurs: ReadonlyArray<readonly [number, number]>): Ligne[] {
  return valeurs.map(([prix, cap], i) => [debut + i * JOUR, cap, prix] as const);
}

/** Points bruts {t, cap, prix} jour après jour à partir de `debut`. */
function bruts(debut: number, valeurs: ReadonlyArray<readonly [number | null, number]>): PointBrut[] {
  return valeurs.map(([prix, cap], i) => ({ t: debut + i * JOUR, cap, prix }));
}

/** Séries journalières des trois pièces (lancement décalé d'un jour, comme le chemin 1d). */
function seriesJournalieres(lignes: Record<IdPiece, ReadonlyArray<readonly [number, number]>>, debut: number): SeriePiece[] {
  return IDS.map((id) => ({ lancement: LANCEMENTS_PAR_ID[id] + JOUR, points: alignerJournalier(bruts(debut, lignes[id])) }));
}

function snapshot(t: number, total: number): McapSnapshot {
  return { t, total, total2: total * 0.41, total3: total * 0.3 };
}

const ohlc = (b: Candle | undefined) => b && { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close };

function installMockLocalStorage(): Map<string, string> {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    clear: () => data.clear(),
    key: (index) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  };
  return data;
}

let stockage: Map<string, string>;
beforeEach(() => {
  stockage = installMockLocalStorage();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe("constantes CMC des pièces", () => {
  it("trois ids distincts et les premiers points mesurés le 29/10/2026", () => {
    expect(IDS_STABLECOINS_CMC).toEqual({ USDT: 825, USDC: 3408, DAI: 4943 });
    expect(LANCEMENTS_STABLECOINS_CMC).toEqual({
      USDT: Date.UTC(2015, 1, 25),
      USDC: Date.UTC(2018, 9, 8),
      DAI: Date.UTC(2019, 10, 22),
    });
  });
});

describe("contributionPiece — 0 avant le lancement, report borné, sinon inconnue", () => {
  const LANCEMENT = Date.UTC(2018, 9, 8);
  const USDC: SeriePiece = {
    lancement: LANCEMENT,
    points: [
      { t: LANCEMENT, v: 0 }, // publié à 0 la première semaine : donnée CMC prise telle quelle
      { t: LANCEMENT + 8 * JOUR, v: 2_000_000 },
      { t: LANCEMENT + 9 * JOUR, v: 2_500_000 },
    ],
  };
  const TOLERANCE = 2 * JOUR;

  it("avant le lancement : 0, valeur exacte (la pièce n'existait pas)", () => {
    expect(contributionPiece(USDC, LANCEMENT - JOUR, TOLERANCE)).toBe(0);
    expect(contributionPiece({ lancement: LANCEMENT, points: [] }, LANCEMENT - 1, TOLERANCE)).toBe(0);
  });

  it("point exact, y compris une capitalisation publiée à 0 après le lancement", () => {
    expect(contributionPiece(USDC, LANCEMENT, TOLERANCE)).toBe(0);
    expect(contributionPiece(USDC, LANCEMENT + 9 * JOUR, TOLERANCE)).toBe(2_500_000);
  });

  it("report de la dernière valeur jusqu'à 2 pas inclus (dernière barre en retard)", () => {
    expect(contributionPiece(USDC, LANCEMENT + 10 * JOUR, TOLERANCE)).toBe(2_500_000);
    expect(contributionPiece(USDC, LANCEMENT + 11 * JOUR, TOLERANCE)).toBe(2_500_000);
  });

  it("au-delà de la tolérance, ou sans point antérieur après le lancement : inconnue (ni 0, ni report illimité)", () => {
    expect(contributionPiece(USDC, LANCEMENT + 11 * JOUR + 1, TOLERANCE)).toBeNull();
    expect(contributionPiece(USDC, LANCEMENT + 3 * JOUR, TOLERANCE)).toBeNull();
    expect(contributionPiece({ lancement: LANCEMENT, points: [] }, LANCEMENT, TOLERANCE)).toBeNull();
  });
});

describe("alignerJournalier — instantané de 00:00 reconstitué depuis les lignes 1d (V2, repli V1)", () => {
  it("la ligne de D−1 donne le point de D : offre de D−1 23:00 × prix de D 00:00 ; sans ligne de D (barre du jour), cap(D−1) telle quelle", () => {
    const [l26, l27, l28] = LIGNES_OCT_2026[825];
    expect(alignerJournalier(bruts(J26, LIGNES_OCT_2026[825]))).toEqual([
      { t: J27, v: (l26![1] * l27![0]) / l26![0] },
      { t: J28, v: (l27![1] * l28![0]) / l27![0] },
      { t: J29, v: l28![1] },
    ]);
  });

  it("28/10/2026 réel : 9,5326 % (vérité horaire de 00:00 : 9,5331 % ; l'appariement brut du lot donnait 9,5127 %)", () => {
    const points = dominanceSurTotal(
      [{ t: J27, total: TOTAL_OCT_2026[0] }, { t: J28, total: TOTAL_OCT_2026[1] }],
      seriesJournalieres(LIGNES_OCT_2026, J26),
      2 * JOUR,
    );
    expect(points.map((p) => p.t)).toEqual([J27, J28]);
    expect(points[0]?.v).toBeCloseTo(9.6208, 4); // vérité 9,6198 ; ancien 9,6223
    expect(points[1]?.v).toBeCloseTo(9.5326, 4);
    expect(Math.abs((points[1]?.v ?? 0) - 9.5331)).toBeLessThan(0.001);
  });

  it("barre du jour (ligne du 29/10 non publiée) : repli V1 sur la ligne du 28/10 → 9,4677 %", () => {
    const series = seriesJournalieres(LIGNES_OCT_2026, J26);
    for (const [i, id] of IDS.entries()) expect(series[i]?.points.at(-1)).toEqual({ t: J29, v: LIGNES_OCT_2026[id][2]![1] });
    const [point] = dominanceSurTotal([{ t: J29, total: TOTAL_OCT_2026[2] }], series, 2 * JOUR);
    expect(point?.v).toBeCloseTo(9.4677, 4);
  });

  it("31/03/2020 (USDT 4,67 → 6,18 G$ entre 00:00 et 01:00) : 3,0407 %, vérité 3,0407 % ; l'appariement brut donnait 3,8969 %", () => {
    const series = seriesJournalieres(LIGNES_MARS_2020, Date.UTC(2020, 2, 30));
    // USDT reconstitué à 00:00 : 4 669 179 117 $, exactement le point horaire réel de 00:00.
    expect(series[0]?.points[0]?.v).toBeCloseTo(4_669_179_117, -1);
    const [point] = dominanceSurTotal([{ t: Date.UTC(2020, 2, 31), total: TOTAL_31_03_2020 }], series, 2 * JOUR);
    expect(point?.v).toBeCloseTo(3.0407, 4);
  });

  it("capitalisation publiée à 0 (DAI jusqu'au 20/01/2020) → 0 ; ensuite V2", () => {
    const dai = bruts(Date.UTC(2020, 0, 20), [[0.985940748543, 0], [0.991402994408, 96_217_610.697], [0.997536946573, 96_812_922.8201]]);
    expect(alignerJournalier(dai)).toEqual([
      { t: Date.UTC(2020, 0, 21), v: 0 },
      { t: Date.UTC(2020, 0, 22), v: (96_217_610.697 * 0.997536946573) / 0.991402994408 },
      { t: Date.UTC(2020, 0, 23), v: 96_812_922.8201 },
    ]);
    expect(alignerJournalier(bruts(J27, [[null, 0], [1, 5]]))[0]).toEqual({ t: J28, v: 0 });
  });

  it("jour brut manquant (USDT, 27/02–01/03/2015 absents) : V1 la veille du trou, aucun point inventé dedans", () => {
    const usdt: PointBrut[] = [
      { t: Date.UTC(2015, 1, 25), cap: 304_476.2603, prix: 1.2101600170135498 },
      { t: Date.UTC(2015, 1, 26), cap: 304_541.6751, prix: 1.21042001247406 },
      { t: Date.UTC(2015, 2, 2), cap: 143_726.2505, prix: 0.5712490081787109 },
      { t: Date.UTC(2015, 2, 3), cap: 152_250.4573, prix: 0.6051290035247803 },
    ];
    const alignes = alignerJournalier(usdt);
    expect(alignes).toEqual([
      { t: Date.UTC(2015, 1, 26), v: (304_476.2603 * 1.21042001247406) / 1.2101600170135498 },
      { t: Date.UTC(2015, 1, 27), v: 304_541.6751 }, // ligne du 27/02 absente : V1
      { t: Date.UTC(2015, 2, 3), v: (143_726.2505 * 0.6051290035247803) / 0.5712490081787109 },
      { t: Date.UTC(2015, 2, 4), v: 152_250.4573 },
    ]);
    // Report de 2 jours au plus : 28/02 et 01/03 reportent le 27/02, le 02/03 n'a aucune valeur.
    const jours = [Date.UTC(2015, 1, 28), Date.UTC(2015, 2, 1), Date.UTC(2015, 2, 2), Date.UTC(2015, 2, 3)];
    const points = dominanceSurTotal(
      jours.map((t) => ({ t, total: 4e9 })),
      [{ lancement: LANCEMENTS_STABLECOINS_CMC.USDT + JOUR, points: alignes }],
      2 * JOUR,
    );
    expect(points.map((p) => p.t)).toEqual([Date.UTC(2015, 1, 28), Date.UTC(2015, 2, 1), Date.UTC(2015, 2, 3)]);
  });

  it("prix invalide (null) d'un côté ou de l'autre : repli V1, cap(D−1) telle quelle", () => {
    const usdt = LIGNES_OCT_2026[825];
    expect(alignerJournalier(bruts(J26, [[usdt[0]![0], usdt[0]![1]], [null, usdt[1]![1]], [usdt[2]![0], usdt[2]![1]]]))).toEqual([
      { t: J27, v: usdt[0]![1] },
      { t: J28, v: usdt[1]![1] },
      { t: J29, v: usdt[2]![1] },
    ]);
  });
});

describe("dominanceSurTotal — 100 × Σ / TOTAL, aucun point plutôt qu'un point faux", () => {
  const PIECES: SeriePiece[] = [
    { lancement: LANCEMENTS_STABLECOINS_CMC.USDT, points: [{ t: J27, v: 60e9 }, { t: J28, v: 61e9 }] },
    { lancement: LANCEMENTS_STABLECOINS_CMC.USDC, points: [{ t: J27, v: 30e9 }, { t: J28, v: 31e9 }] },
    { lancement: LANCEMENTS_STABLECOINS_CMC.DAI, points: [{ t: J27, v: 10e9 }, { t: J28, v: 11e9 }] },
  ];

  it("somme des contributions sur le TOTAL du même instant, report dans la tolérance", () => {
    const points = dominanceSurTotal([J27, J28, J29].map((t) => ({ t, total: 1e12 })), PIECES, 2 * JOUR);
    expect(points).toEqual([{ t: J27, v: 10 }, { t: J28, v: 10.3 }, { t: J29, v: 10.3 }]);
  });

  it("aucun point si le TOTAL n'est pas fini ou ≤ 0, ou si une contribution est inconnue", () => {
    const points = dominanceSurTotal(
      [
        { t: J27, total: 0 },
        { t: J28, total: Number.NaN },
        { t: J28 + 3 * JOUR, total: 2.7e12 }, // pièces muettes depuis 3 jours : au-delà de 2 pas
      ],
      PIECES,
      2 * JOUR,
    );
    expect(points).toEqual([]);
  });

  it("somme nulle avant USDT : rien n'est tracé", () => {
    const usdt: SeriePiece = { lancement: LANCEMENTS_STABLECOINS_CMC.USDT, points: [{ t: LANCEMENTS_STABLECOINS_CMC.USDT, v: 250_000 }] };
    const autres: SeriePiece[] = [
      { lancement: LANCEMENTS_STABLECOINS_CMC.USDC, points: [] },
      { lancement: LANCEMENTS_STABLECOINS_CMC.DAI, points: [] },
    ];
    const points = dominanceSurTotal(
      [LANCEMENTS_STABLECOINS_CMC.USDT - JOUR, LANCEMENTS_STABLECOINS_CMC.USDT].map((t) => ({ t, total: 5e9 })),
      [usdt, ...autres],
      2 * JOUR,
    );
    expect(points.map((p) => p.t)).toEqual([LANCEMENTS_STABLECOINS_CMC.USDT]);
    expect(points[0]?.v).toBeCloseTo(0.005, 12); // 250 k$ sur 5 G$
  });
});

describe("bougiesDominance — intrajournalier (pages CMC, pièces en 1h)", () => {
  it("1h : trois appels par id distincts, fenêtre [début − 2 h, fin], report d'un pas sur la dernière barre", async () => {
    const fin = Date.UTC(2026, 9, 29, 9);
    const cmc = serveur({
      global: (debut, finRequete) => grille(debut, finRequete, HEURE, () => 1e12),
      // Retard réel : global 1h à 09:00, pièces à 08:00.
      pieces: piecesDixPourcent(fin - HEURE),
    });

    const bougies = await bougiesDominance("1h", { endTime: fin, limit: 3 }, {
      fetcher: cmc.fetcher,
      maintenant: () => MAINTENANT,
    });

    expect(bougies.map((b) => b.time)).toEqual([fin - 2 * HEURE, fin - HEURE, fin]);
    for (const bougie of bougies) expect(bougie.close).toBeCloseTo(10, 10);
    for (const id of IDS) {
      const appels = cmc.appelsPiece(id);
      expect(appels).toHaveLength(1);
      expect(appels[0]?.searchParams.get("interval")).toBe("1h");
      expect(secondes(appels[0], "timeStart")).toBe(fin - 4 * HEURE);
      expect(secondes(appels[0], "timeEnd")).toBe(fin);
    }
    // Jamais de multi-id (refusé par CMC) : chaque appel porte un seul id.
    expect(cmc.appels().every((url) => !(url.searchParams.get("id") ?? "").includes(","))).toBe(true);
    const globaux = cmc.appels().filter((url) => url.pathname.includes("global-metrics"));
    expect(globaux.map((url) => url.searchParams.get("interval"))).toEqual(["1h"]);
  });

  it("4h : global en 4h mais pièces lues en 1h (interval=4h renvoie du journalier)", async () => {
    const fin = Date.UTC(2026, 9, 29, 8);
    const cmc = serveur({
      global: (debut, finRequete, intervalle) => {
        expect(intervalle).toBe("4h");
        return grille(debut, finRequete, 4 * HEURE, () => 1e12);
      },
      pieces: piecesDixPourcent(fin),
    });

    const bougies = await bougiesDominance("4h", { endTime: fin, limit: 2 }, { fetcher: cmc.fetcher, maintenant: () => MAINTENANT });

    expect(bougies.map((b) => b.time)).toEqual([fin - 4 * HEURE, fin]);
    for (const id of IDS) {
      expect(cmc.appelsPiece(id).map((url) => url.searchParams.get("interval"))).toEqual(["1h"]);
    }
  });

  it("4h : amorce des pièces = début − 2 h (2 pas de la PIÈCE, pas 2 × 4 h) ; pièce muette depuis 3 h → aucune bougie", async () => {
    const fin = Date.UTC(2026, 9, 29, 8);
    const cmc = serveur({
      global: (debut, finRequete) => grille(debut, finRequete, 4 * HEURE, () => 1e12),
      pieces: piecesDixPourcent(fin - 3 * HEURE), // dernier point horaire à 05:00
    });

    const bougies = await bougiesDominance("4h", { endTime: fin, limit: 2 }, { fetcher: cmc.fetcher, maintenant: () => MAINTENANT });

    for (const id of IDS) expect(secondes(cmc.appelsPiece(id)[0], "timeStart")).toBe(fin - 4 * HEURE - 2 * HEURE);
    expect(bougies.map((b) => b.time)).toEqual([fin - 4 * HEURE]);
  });

  it("chaque pièce se lit en lots séquentiels sous la taille de lot (10 000 points, injectable), les trois pièces en parallèle", async () => {
    const fin = Date.UTC(2026, 9, 29, 9);
    const cmc = serveur({
      global: (debut, finRequete) => grille(debut, finRequete, HEURE, () => 1e12),
      pieces: piecesDixPourcent(fin),
    });
    // Requêtes simultanées par id : un lot ne part qu'après la réponse du précédent.
    const enVol = new Map<string, number>();
    let maxSimultanees = 0;
    // Requêtes de pièces simultanées, ids confondus : les trois pièces se chevauchent.
    let piecesEnVol = 0;
    let maxPiecesEnVol = 0;
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const id = new URL(String(input), "http://localhost").searchParams.get("id") ?? "global";
      enVol.set(id, (enVol.get(id) ?? 0) + 1);
      maxSimultanees = Math.max(maxSimultanees, enVol.get(id) ?? 0);
      if (id !== "global") maxPiecesEnVol = Math.max(maxPiecesEnVol, ++piecesEnVol);
      await Promise.resolve();
      try {
        return await cmc.fetcher(input, init);
      } finally {
        enVol.set(id, (enVol.get(id) ?? 1) - 1);
        if (id !== "global") piecesEnVol -= 1;
      }
    }) as typeof fetch;

    const bougies = await bougiesDominance("1h", { endTime: fin, limit: 3 }, {
      fetcher,
      maintenant: () => MAINTENANT,
      tailleLotPiecePoints: 2,
    });

    for (const bougie of bougies) expect(bougie.close).toBeCloseTo(10, 10);
    expect(bougies).toHaveLength(3);
    for (const id of IDS) {
      // Fenêtre [fin − 4 h, fin] = 5 points → 3 lots contigus, dans l'ordre, bornes incluses.
      const lots = cmc.appelsPiece(id).map((url) => [secondes(url, "timeStart"), secondes(url, "timeEnd")]);
      expect(lots).toEqual([
        [fin - 4 * HEURE, fin - 3 * HEURE],
        [fin - 2 * HEURE, fin - HEURE],
        [fin, fin],
      ]);
    }
    expect(maxSimultanees).toBe(1);
    expect(maxPiecesEnVol).toBe(3);
  });

  it("une page antérieure au lancement de USDC et DAI ne les interroge pas (contribution 0)", async () => {
    const fin = Date.UTC(2017, 5, 1, 12);
    const cmc = serveur({
      global: (debut, finRequete) => grille(debut, finRequete, HEURE, () => 1e11),
      pieces: { 825: pieceConstante(825, 1e9, fin) },
    });

    const bougies = await bougiesDominance("1h", { endTime: fin, limit: 2 }, { fetcher: cmc.fetcher, maintenant: () => MAINTENANT });

    expect(bougies.map((b) => b.close)).toEqual([1, 1]);
    expect(cmc.appelsPiece(3408)).toHaveLength(0);
    expect(cmc.appelsPiece(4943)).toHaveLength(0);
  });

  it("erreur CMC servie en HTTP 200 : message explicite, aucun repli", async () => {
    const fin = Date.UTC(2026, 9, 29, 9);
    const pieces = piecesDixPourcent(fin);
    delete pieces[3408]; // l'id 3408 reçoit l'erreur réelle « The system is busy »
    const cmc = serveur({ global: (debut, finRequete) => grille(debut, finRequete, HEURE, () => 1e12), pieces });

    const echec = bougiesDominance("1h", { endTime: fin, limit: 3 }, { fetcher: cmc.fetcher, maintenant: () => MAINTENANT });

    await expect(echec).rejects.toThrow(
      "Dominance stablecoins indisponible : CoinMarketCap public ne répond pas — aucun repli, ni CCData ni CoinGecko ne publient ces capitalisations",
    );
    await expect(echec).rejects.toMatchObject({ name: "ErreurDominanceStablecoins" });
  });

  // Sondé le 29/10/2026 (11:30–11:41 UTC) : la série 1h de chaque pièce commence quelques heures
  // après le minuit de son lancement (USDT 2015-02-25 13:00, USDC 2018-10-08 18:00, DAI
  // 2019-11-22 01:00), et CMC répond entre les deux `error_code 0` avec `points: []`.
  it("1h : avant le premier point horaire d'une pièce (CMC répond `points: []`), la page rend ce qu'elle sait, sans échec", async () => {
    const premierPointUsdc = LANCEMENTS_STABLECOINS_CMC.USDC + 18 * HEURE;
    // Page qui suit une page dont la première bougie est à 18:00 : elle finit à 17:00. Elle échouait
    // à chaque défilement, et la pagination 1h restait bloquée au 2018-10-08.
    const fin = premierPointUsdc - HEURE;
    const cmc = serveur({
      global: (debut, finRequete) => grille(debut, finRequete, HEURE, () => 1e11),
      pieces: {
        825: pieceConstante(825, 2e9, fin),
        3408: (debut, finRequete) => grille(Math.max(debut, premierPointUsdc), finRequete, HEURE, () => 0),
      },
    });

    const bougies = await bougiesDominance("1h", { endTime: fin, limit: 24 }, { fetcher: cmc.fetcher, maintenant: () => MAINTENANT });

    // Avant le lancement d'USDC : USDT seul (2 G$ / 100 G$) ; de minuit à 17:00, USDC inconnue → aucune bougie.
    expect(bougies.map((b) => b.time)).toEqual(
      grille(fin - 23 * HEURE, LANCEMENTS_STABLECOINS_CMC.USDC - HEURE, HEURE, () => 0).map(([t]) => t),
    );
    for (const bougie of bougies) expect(bougie.close).toBeCloseTo(2, 10);
    expect(cmc.appelsPiece(3408)).toHaveLength(1);
    expect(cmc.appelsPiece(4943)).toHaveLength(0);
  });

  it("1h : dernière page de l'historique (USDT avant son premier point horaire, 13:00) → vide, sans échec", async () => {
    const premierPointUsdt = LANCEMENTS_STABLECOINS_CMC.USDT + 13 * HEURE;
    const cmc = serveur({
      global: (debut, finRequete) => grille(debut, finRequete, HEURE, () => 5e9),
      pieces: { 825: (debut, finRequete) => grille(Math.max(debut, premierPointUsdt), finRequete, HEURE, () => 250_000) },
    });

    // Une page vide arrête la pagination ; une erreur la ferait rejouer à chaque défilement.
    await expect(
      bougiesDominance("1h", { endTime: premierPointUsdt - HEURE, limit: 24 }, { fetcher: cmc.fetcher, maintenant: () => MAINTENANT }),
    ).resolves.toEqual([]);
    expect(cmc.appelsPiece(825)).toHaveLength(1);
  });

  // Hors de sa journée de lancement, une pièce vide en `error_code 0` est une panne CMC : sans
  // erreur, l'overlay dirait « historique vide » au chargement et la pagination s'arrêterait pour
  // la session (une page vide clôt le défilement, une erreur est réessayée).
  it.each(["1h", "4h"] as const)("%s : une pièce vide après sa journée de lancement est un échec explicite", async (tf) => {
    const fin = Date.UTC(2026, 9, 29, 8);
    const cmc = serveur({
      global: (debut, finRequete, intervalle) => grille(debut, finRequete, intervalle === "4h" ? 4 * HEURE : HEURE, () => 1e12),
      pieces: { ...piecesDixPourcent(fin), 4943: () => [] },
    });

    const echec = bougiesDominance(tf, { endTime: fin, limit: 3 }, { fetcher: cmc.fetcher, maintenant: () => MAINTENANT });

    await expect(echec).rejects.toThrow(/^Dominance stablecoins indisponible/);
    await expect(echec).rejects.toMatchObject({
      name: "ErreurDominanceStablecoins",
      cause: expect.objectContaining({ message: "CoinMarketCap public ne renvoie aucune capitalisation pour l'id 4943" }),
    });
    expect(cmc.appelsPiece(4943).map((url) => url.searchParams.get("interval"))).toEqual(["1h"]);
  });

  it("1h : l'exemption s'arrête au minuit qui suit le lancement (avant : la page rend ce qu'elle sait ; à partir de là : échec)", async () => {
    const lancementDai = LANCEMENTS_STABLECOINS_CMC.DAI;
    // DAI muette (panne) ; USDT 60 G$ et USDC 30 G$ ; avant son lancement, DAI vaut exactement 0.
    const servir = () => serveur({
      global: (debut, finRequete) => grille(debut, finRequete, HEURE, () => 1e12),
      pieces: { ...piecesDixPourcent(lancementDai + JOUR), 4943: () => [] },
    });

    // Fin à 23:00 le jour du lancement : indiscernable d'un premier point horaire tardif.
    const tolerees = await bougiesDominance("1h", { endTime: lancementDai + 23 * HEURE, limit: 48 }, {
      fetcher: servir().fetcher,
      maintenant: () => MAINTENANT,
    });
    expect(tolerees.map((b) => b.time)).toEqual(grille(lancementDai - 24 * HEURE, lancementDai - HEURE, HEURE, () => 0).map(([t]) => t));
    for (const bougie of tolerees) expect(bougie.close).toBeCloseTo(9, 10);

    await expect(
      bougiesDominance("1h", { endTime: lancementDai + JOUR, limit: 48 }, { fetcher: servir().fetcher, maintenant: () => MAINTENANT }),
    ).rejects.toMatchObject({
      name: "ErreurDominanceStablecoins",
      cause: expect.objectContaining({ message: "CoinMarketCap public ne renvoie aucune capitalisation pour l'id 4943" }),
    });
  });
});

describe("chargerStablesJournalieres — lignes brutes (prix compris), cache séparé axiom:mcap:cmc-stables:v2", () => {
  it("premier chargement : chaque pièce depuis son lancement ; cache compact (premier jour, dollars, prix à 6 décimales, null)", async () => {
    const cmc = serveur({
      global: () => [],
      pieces: {
        825: () => [[J27 - JOUR, 1.4, 0.9986756189948013], [J28, 181_559_686_290.58582, 0.9986550873117038]], // le 27/10 manque
        3408: () => [[J28, 71_231_226_037.00807]],
        4943: () => [[J28, 4_561_176_052.843347]],
      },
    });

    const pieces = await chargerStablesJournalieres({ fetcher: cmc.fetcher, maintenant: () => MAINTENANT });

    for (const id of IDS) {
      const [appel] = cmc.appelsPiece(id);
      expect(appel?.searchParams.get("interval")).toBe("1d");
      expect(secondes(appel, "timeStart")).toBe(LANCEMENTS_PAR_ID[id]);
      expect(secondes(appel, "timeEnd")).toBe(J29);
    }
    expect(pieces.USDT).toEqual([
      { t: J27 - JOUR, cap: 1.4, prix: 0.9986756189948013 },
      { t: J28, cap: 181_559_686_290.58582, prix: 0.9986550873117038 },
    ]);
    expect(CLE_CACHE_STABLES).toBe("axiom:mcap:cmc-stables:v2");
    expect(JSON.parse(stockage.get(CLE_CACHE_STABLES) ?? "null")).toEqual({
      version: 2,
      majTs: MAINTENANT,
      pieces: {
        USDT: { debut: J27 - JOUR, caps: [1, null, 181_559_686_291], prix: [0.998676, null, 0.998655] },
        USDC: { debut: J28, caps: [71_231_226_037], prix: [0.9986] },
        DAI: { debut: J28, caps: [4_561_176_053], prix: [0.9986] },
      },
    });
  });

  it("lignes 1d : même tolérance que normaliserEthCmc (entrée invalide ignorée, capitalisation finie ≥ 0) ; prix fini > 0, sinon null", async () => {
    const cmc = serveur({ global: () => [], pieces: piecesDixPourcent() });
    const s = (t: number) => String(t / 1000);
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input), "http://localhost").searchParams.get("id") !== "825") return cmc.fetcher(input, init);
      return reponse({
        data: {
          points: [
            null,
            { s: "pas une date", v: [1, 0, 5] },
            { s: s(J26 - 2 * JOUR), v: [1, 0, -5] }, // capitalisation négative : ignorée
            { s: s(J26 - JOUR), v: [1, 0, null] }, // capitalisation absente : ignorée
            { s: s(J26), v: [0, 0, 10] }, // prix nul : invalide
            { s: s(J27 + 5 * HEURE), v: ["abc", 0, "20"] }, // instant ramené au jour ; prix illisible
            { s: s(J28), v: [0.9991, 0, 30] },
          ],
        },
        status: { error_code: "0" },
      });
    }) as typeof fetch;

    const pieces = await chargerStablesJournalieres({ fetcher, maintenant: () => MAINTENANT });

    expect(pieces.USDT).toEqual([
      { t: J26, cap: 10, prix: null },
      { t: J27, cap: 20, prix: null },
      { t: J28, cap: 30, prix: 0.9991 },
    ]);
  });

  it("cache frais (< 12 h) : aucun appel réseau", async () => {
    const cmc = serveur({ global: () => [], pieces: piecesDixPourcent() });
    await chargerStablesJournalieres({ fetcher: cmc.fetcher, maintenant: () => MAINTENANT });
    cmc.mock.mockClear();

    const pieces = await chargerStablesJournalieres({ fetcher: cmc.fetcher, maintenant: () => MAINTENANT + 11 * HEURE });

    expect(cmc.mock).not.toHaveBeenCalled();
    expect(pieces.DAI.at(-1)).toEqual({ t: J28, cap: 10e9, prix: 0.9986 });
  });

  it("un majTs dans le futur (horloge avancée puis corrigée) vaut cache périmé : rafraîchi", async () => {
    const cmc = serveur({ global: () => [], pieces: piecesDixPourcent() });
    await chargerStablesJournalieres({ fetcher: cmc.fetcher, maintenant: () => MAINTENANT + 365 * JOUR });
    cmc.mock.mockClear();

    await chargerStablesJournalieres({ fetcher: cmc.fetcher, maintenant: () => MAINTENANT });

    for (const id of IDS) expect(cmc.appelsPiece(id)).toHaveLength(1);
  });

  it("rafraîchissement incrémental depuis min(maintenant − 45 j, fin du cache − 1 j) ; la nouvelle ligne (cap ET prix) l'emporte", async () => {
    const cmc = serveur({ global: () => [], pieces: piecesDixPourcent(J28) });
    await chargerStablesJournalieres({ fetcher: cmc.fetcher, maintenant: () => MAINTENANT });
    cmc.mock.mockClear();

    // Trois jours plus tard, les pièces ont publié jusqu'au 31/10 avec de nouvelles valeurs.
    const plusTard = MAINTENANT + 3 * JOUR;
    const revise = (id: IdPiece, cap: number): Serie => (debut, fin, intervalle) =>
      pieceConstante(id, cap, J28 + 3 * JOUR)(debut, fin, intervalle).map(([t, valeur]) => [t, valeur, 0.9991] as const);
    const neuf = serveur({ global: () => [], pieces: { 825: revise(825, 61e9), 3408: revise(3408, 31e9), 4943: revise(4943, 11e9) } });
    const pieces = await chargerStablesJournalieres({ fetcher: neuf.fetcher, maintenant: () => plusTard });

    for (const id of IDS) {
      // 01/11 09:46 − 45 j = 17/09 09:46, ramené au jour.
      expect(secondes(neuf.appelsPiece(id)[0], "timeStart")).toBe(Date.UTC(2026, 8, 17));
    }
    // L'historique ancien est conservé ; la fenêtre récente est remplacée, jour du recouvrement compris.
    expect(pieces.USDT[0]).toEqual({ t: LANCEMENTS_STABLECOINS_CMC.USDT, cap: 60e9, prix: 0.9986 });
    expect(pieces.USDT.find((p) => p.t === Date.UTC(2026, 8, 1))).toEqual({ t: Date.UTC(2026, 8, 1), cap: 60e9, prix: 0.9986 });
    expect(pieces.USDT.find((p) => p.t === Date.UTC(2026, 9, 18))).toEqual({ t: Date.UTC(2026, 9, 18), cap: 61e9, prix: 0.9991 });
    expect(pieces.USDT.at(-1)).toEqual({ t: J28 + 3 * JOUR, cap: 61e9, prix: 0.9991 });
  });

  it("cache de plus de 45 jours : la fenêtre rejoint la fin du cache (aucun trou définitif)", async () => {
    const cmc = serveur({ global: () => [], pieces: piecesDixPourcent(J28) });
    await chargerStablesJournalieres({ fetcher: cmc.fetcher, maintenant: () => MAINTENANT });

    const soixanteJours = MAINTENANT + 60 * JOUR;
    const neuf = serveur({ global: () => [], pieces: piecesDixPourcent(J28 + 60 * JOUR) });
    const pieces = await chargerStablesJournalieres({ fetcher: neuf.fetcher, maintenant: () => soixanteJours });

    for (const id of IDS) expect(secondes(neuf.appelsPiece(id)[0], "timeStart")).toBe(J28 - JOUR);
    const jours = pieces.USDC.map((p) => p.t);
    for (let t = J28; t <= J28 + 60 * JOUR; t += JOUR) expect(jours).toContain(t);
  });

  it("capitalisations publiées à 0 (DAI jusqu'au 20/01/2020) : l'aller-retour par le cache garde des points à 0, pas des trous", async () => {
    const finZeroDai = Date.UTC(2020, 0, 20);
    const cmc = serveur({
      global: () => [],
      pieces: { ...piecesDixPourcent(J28), 4943: (debut, fin) => grille(Math.max(debut, LANCEMENTS_STABLECOINS_CMC.DAI), Math.min(fin, J28), JOUR, (t) => (t <= finZeroDai ? 0 : 10e9)) },
    });
    const frais = await chargerStablesJournalieres({ fetcher: cmc.fetcher, maintenant: () => MAINTENANT });
    const zerosFrais = frais.DAI.filter((p) => p.cap === 0).length;
    cmc.mock.mockClear();

    const relus = await chargerStablesJournalieres({ fetcher: cmc.fetcher, maintenant: () => MAINTENANT + HEURE });

    expect(cmc.mock).not.toHaveBeenCalled(); // servi du cache
    expect(zerosFrais).toBe(60); // 22/11/2019 → 20/01/2020
    expect(relus.DAI.filter((p) => p.cap === 0)).toHaveLength(zerosFrais);
    expect(relus.DAI.find((p) => p.t === Date.UTC(2019, 11, 25))).toEqual({ t: Date.UTC(2019, 11, 25), cap: 0, prix: 0.9986 });
  });

  it("lecture tolérante : JSON corrompu, version inconnue (v1 comprise) ou pièce manquante → rechargement complet", async () => {
    const piece = { debut: J28, caps: [1], prix: [1] };
    for (const brut of [
      "{pas du json",
      // Version inconnue mais pièces valides et cache « frais » : seule la version le disqualifie.
      JSON.stringify({ version: 1, majTs: MAINTENANT, pieces: { USDT: { debut: J28, caps: [1] }, USDC: { debut: J28, caps: [1] }, DAI: { debut: J28, caps: [1] } } }),
      JSON.stringify({ version: 3, majTs: MAINTENANT, pieces: { USDT: piece, USDC: piece, DAI: piece } }),
      JSON.stringify({ version: 2, majTs: MAINTENANT, pieces: { USDT: piece } }),
    ]) {
      stockage.set(CLE_CACHE_STABLES, brut);
      const cmc = serveur({ global: () => [], pieces: piecesDixPourcent() });
      await chargerStablesJournalieres({ fetcher: cmc.fetcher, maintenant: () => MAINTENANT });
      expect(secondes(cmc.appelsPiece(825)[0], "timeStart")).toBe(LANCEMENTS_STABLECOINS_CMC.USDT);
    }
  });

  it("lecture tolérante : prix absents (forme v1), tableau de prix plus court ou valeur invalide → prix null (repli V1), sans rejeter le cache", async () => {
    stockage.set(CLE_CACHE_STABLES, JSON.stringify({
      version: 2,
      majTs: MAINTENANT,
      pieces: {
        USDT: { debut: J26, caps: [100, 200, 300] },
        USDC: { debut: J26, caps: [100, 200, 300], prix: [1.01] },
        DAI: { debut: J26, caps: [100, "x", -5, 400], prix: [0, 1.02, 1.03, "0.99"] },
      },
    }));
    const cmc = serveur({ global: () => [], pieces: piecesDixPourcent() });

    const pieces = await chargerStablesJournalieres({ fetcher: cmc.fetcher, maintenant: () => MAINTENANT + HEURE });

    expect(cmc.mock).not.toHaveBeenCalled();
    expect(pieces.USDT).toEqual(bruts(J26, [[null, 100], [null, 200], [null, 300]]));
    expect(pieces.USDC).toEqual(bruts(J26, [[1.01, 100], [null, 200], [null, 300]]));
    expect(pieces.DAI).toEqual([{ t: J26, cap: 100, prix: null }, { t: J26 + 3 * JOUR, cap: 400, prix: null }]);
  });

  it("une pièce en échec fait échouer le rafraîchissement : cache de 24 h au plus servi, signalé en console (âge et cause)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cmc = serveur({ global: () => [], pieces: piecesDixPourcent(J28) });
    await chargerStablesJournalieres({ fetcher: cmc.fetcher, maintenant: () => MAINTENANT });
    const avant = stockage.get(CLE_CACHE_STABLES);

    const enPanne = serveur({ global: () => [], pieces: { ...piecesDixPourcent(J28), 4943: undefined } });
    const servies = await chargerStablesJournalieres({ fetcher: enPanne.fetcher, maintenant: () => MAINTENANT + 13 * HEURE });

    expect(servies.DAI.at(-1)).toEqual({ t: J28, cap: 10e9, prix: 0.9986 });
    expect(stockage.get(CLE_CACHE_STABLES)).toBe(avant); // rien n'est réécrit (majTs inchangé)
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toBe("[AXIOM] STABLE.D : rafraîchissement CMC des pièces en échec — cache de 13 h servi");
    expect(warn.mock.calls[0]?.[1]).toMatchObject({ message: "CoinMarketCap public erreur 500" });

    // 24 h pile : encore servi.
    await expect(chargerStablesJournalieres({ fetcher: enPanne.fetcher, maintenant: () => MAINTENANT + 24 * HEURE })).resolves.toBeDefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("au-delà de 24 h, sans cache ou avec un majTs futur : un rafraîchissement en échec est une erreur (jamais une série tronquée servie)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const enPanne = serveur({ global: () => [], pieces: { ...piecesDixPourcent(J28), 4943: undefined } });
    await expect(chargerStablesJournalieres({ fetcher: enPanne.fetcher, maintenant: () => MAINTENANT })).rejects.toThrow(/CoinMarketCap public erreur 500/);

    const cmc = serveur({ global: () => [], pieces: piecesDixPourcent(J28) });
    await chargerStablesJournalieres({ fetcher: cmc.fetcher, maintenant: () => MAINTENANT });
    await expect(chargerStablesJournalieres({ fetcher: enPanne.fetcher, maintenant: () => MAINTENANT + 30 * HEURE })).rejects.toThrow(/CoinMarketCap public erreur 500/);
    await expect(
      bougiesDominance("1d", {}, { fetcher: enPanne.fetcher, maintenant: () => MAINTENANT + 30 * HEURE, chargerHistorique: async () => [snapshot(J29, 1e12)] }),
    ).rejects.toMatchObject({ name: "ErreurDominanceStablecoins" });

    await chargerStablesJournalieres({ fetcher: cmc.fetcher, maintenant: () => MAINTENANT + 365 * JOUR });
    await expect(chargerStablesJournalieres({ fetcher: enPanne.fetcher, maintenant: () => MAINTENANT })).rejects.toThrow(/CoinMarketCap public erreur 500/);
  });
});

describe("bougiesDominance — journalier (TOTAL CMC en cache + pièces alignées sur 00:00)", () => {
  function serveurReel() {
    return serveur({
      global: () => [],
      pieces: Object.fromEntries(IDS.map((id) => [id, () => lignesServies(J26, LIGNES_OCT_2026[id])])),
    });
  }
  const historiqueReel = async () => [J27, J28, J29].map((t, i) => snapshot(t, TOTAL_OCT_2026[i] ?? 0));

  it("valeurs réelles : 27/10 9,6208 %, 28/10 9,5326 % (vérité 9,5331 %), barre du jour 29/10 9,4677 % (repli V1)", async () => {
    const bougies = await bougiesDominance("1d", { limit: 500 }, {
      fetcher: serveurReel().fetcher,
      maintenant: () => MAINTENANT,
      chargerHistorique: historiqueReel,
    });

    expect(bougies.map((b) => b.time)).toEqual([J27, J28, J29]);
    expect(bougies[0]?.close).toBeCloseTo(9.6208, 4);
    expect(bougies[1]?.open).toBeCloseTo(9.6208, 4);
    expect(bougies[1]?.close).toBeCloseTo(9.5326, 4);
    expect(bougies[2]?.close).toBeCloseTo(9.4677, 4);
    expect(bougies[2]?.closed).toBe(false);
    for (const bougie of bougies) expect(bougie.volume).toBe(0);
  });

  it("prix servi invalide (null) le 28/10 : repli V1 pour ce jour (9,5305 %), jamais une valeur inventée", async () => {
    const cmc = serveur({
      global: () => [],
      pieces: Object.fromEntries(IDS.map((id) => [id, () => lignesServies(J26, LIGNES_OCT_2026[id]).map(([t, cap, prix]) => [t, cap, t === J28 ? null : prix] as const)])),
    });

    const bougies = await bougiesDominance("1d", {}, { fetcher: cmc.fetcher, maintenant: () => MAINTENANT, chargerHistorique: historiqueReel });

    expect(bougies[1]?.close).toBeCloseTo(9.5305, 4);
  });

  it("respecte endTime et limit, et agrège en 1w", async () => {
    const options = { fetcher: serveurReel().fetcher, maintenant: () => MAINTENANT, chargerHistorique: historiqueReel };
    const bornees = await bougiesDominance("1d", { endTime: J28, limit: 1 }, options);
    expect(bornees.map((b) => b.time)).toEqual([J28]);

    const semaine = await bougiesDominance("1w", {}, { ...options, fetcher: serveurReel().fetcher });
    // Lundi 26/10/2026 : une seule bougie hebdomadaire, ouverte au 27/10, close au 29/10.
    expect(semaine).toHaveLength(1);
    expect(semaine[0]?.time).toBe(Date.UTC(2026, 9, 26));
    expect(semaine[0]?.high).toBeCloseTo(9.6208, 4);
    expect(semaine[0]?.low).toBeCloseTo(9.4677, 4);
  });

  it("lancement décalé d'un jour : le 08/10/2018 (USDC inexistante à 00:00) vaut USDT seul, sans trou", async () => {
    const lancement = LANCEMENTS_STABLECOINS_CMC.USDC;
    const cmc = serveur({
      global: () => [],
      pieces: {
        ...piecesDixPourcent(J28),
        825: pieceConstante(825, 2e9),
        3408: (debut, fin) => grille(Math.max(debut, lancement), Math.min(fin, J28), JOUR, (t) => (t === lancement ? 0 : 1e9)),
      },
    });

    const bougies = await bougiesDominance("1d", {}, {
      fetcher: cmc.fetcher,
      maintenant: () => MAINTENANT,
      chargerHistorique: async () => [-1, 0, 1, 2].map((i) => snapshot(lancement + i * JOUR, 100e9)),
    });

    // 08/10 : USDC compte 0 (lancement) ; 09/10 : sa ligne du 08/10 (0 $) ; 10/10 : celle du 09/10 (1 G$).
    expect(bougies.map((b) => [b.time, b.close])).toEqual([
      [lancement - JOUR, 2],
      [lancement, 2],
      [lancement + JOUR, 2],
      [lancement + 2 * JOUR, 3],
    ]);
  });

  it("une pièce qui ne renvoie aucun point après son lancement est un échec (pas de sous-comptage silencieux)", async () => {
    // Journalier : sans cette règle, le rafraîchissement réécrirait un cache périmé avec un majTs neuf.
    const cmc = serveur({ global: () => [], pieces: { ...piecesDixPourcent(J28), 4943: () => [] } });

    const echec = bougiesDominance("1d", {}, {
      fetcher: cmc.fetcher,
      maintenant: () => MAINTENANT,
      chargerHistorique: async () => [snapshot(J28, 1e12)],
    });

    await expect(echec).rejects.toThrow(/^Dominance stablecoins indisponible/);
    await expect(echec).rejects.toMatchObject({
      cause: expect.objectContaining({ message: "CoinMarketCap public ne renvoie aucune capitalisation pour l'id 4943" }),
    });
    expect(stockage.has(CLE_CACHE_STABLES)).toBe(false);
  });

  it("écriture best-effort : un setItem qui lève (quota plein, mode privé) n'empêche pas de servir les bougies", async () => {
    const setItem = vi.fn(() => {
      throw new DOMException("Le quota est dépassé", "QuotaExceededError");
    });
    (globalThis as { localStorage: Storage }).localStorage.setItem = setItem;
    const cmc = serveur({ global: () => [], pieces: piecesDixPourcent(J28) });

    const bougies = await bougiesDominance("1d", {}, {
      fetcher: cmc.fetcher,
      maintenant: () => MAINTENANT,
      chargerHistorique: async () => [snapshot(J28, 1e12)],
    });

    expect(setItem).toHaveBeenCalledTimes(1);
    expect(bougies.map((b) => [b.time, b.close])).toEqual([[J28, 10]]);
    expect(stockage.has(CLE_CACHE_STABLES)).toBe(false);
  });

  it("TOTAL CMC indisponible (null) : message explicite, aucun repli CCData/CoinGecko", async () => {
    await expect(
      bougiesDominance("1d", {}, { fetcher: serveurReel().fetcher, maintenant: () => MAINTENANT, chargerHistorique: async () => null }),
    ).rejects.toThrow(/^Dominance stablecoins indisponible : CoinMarketCap public ne répond pas/);
  });
});

describe("abonnerDominance — repoll de la bougie courante", () => {
  it("1h : toutes les 5 min, n'émet que la bougie du bucket courant quand elle change, puis s'arrête", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 29, 9, 30));
    let total = 1e12;
    const cmc = serveur({
      global: (debut, fin) => grille(debut, fin, HEURE, () => total),
      pieces: piecesDixPourcent(Date.UTC(2026, 9, 29, 8)),
    });
    const cb = vi.fn();
    const arreter = abonnerDominance("1h", cb, { fetcher: cmc.fetcher });

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]?.[0]).toMatchObject({ time: Date.UTC(2026, 9, 29, 9), open: 10, close: 10 });

    await vi.advanceTimersByTimeAsync(5 * 60_000); // page identique : aucune réémission
    expect(cb).toHaveBeenCalledTimes(1);

    total = 1.25e12; // la barre courante change : 100 G$ / 1,25 T$ = 8 %
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[1]?.[0]).toMatchObject({ time: Date.UTC(2026, 9, 29, 9), close: 8 });

    arreter();
    const appels = cmc.mock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(cmc.mock.mock.calls.length).toBe(appels);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("1h : page = [début du bucket − 2 h, maintenant] et ouverture = clôture de l'heure précédente, sur des valeurs distinctes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 29, 9, 30));
    const h = (heure: number) => Date.UTC(2026, 9, 29, heure);
    const totalHoraire = (t: number) => 1e12 * (1 + 0.01 * ((t / HEURE) % 5));
    const cmc = serveur({
      global: (debut, fin) => grille(debut, Math.min(fin, h(9)), HEURE, totalHoraire),
      pieces: piecesDixPourcent(h(8)),
    });
    const cb = vi.fn();
    const arreter = abonnerDominance("1h", cb, { fetcher: cmc.fetcher });

    await vi.advanceTimersByTimeAsync(5 * 60_000); // 09:35
    arreter();

    const [global] = cmc.appels().filter((url) => url.pathname.includes("global-metrics"));
    expect([secondes(global, "timeStart"), secondes(global, "timeEnd")]).toEqual([h(7), h(9)]);
    for (const id of IDS) expect([secondes(cmc.appelsPiece(id)[0], "timeStart"), secondes(cmc.appelsPiece(id)[0], "timeEnd")]).toEqual([h(5), h(9)]);
    expect(cb).toHaveBeenCalledTimes(1);
    const emise = cb.mock.calls[0]?.[0] as Candle;
    expect(emise.time).toBe(h(9));
    expect(emise.open).toBeCloseTo((100 * 100e9) / totalHoraire(h(8)), 12);
    expect(emise.close).toBeCloseTo((100 * 100e9) / totalHoraire(h(9)), 12);
    expect(emise.open).not.toBeCloseTo(emise.close, 6);
  });

  it("4h : cadence de 5 min comme TOTAL, global en 4h et pièces en 1h, bougie du bucket de 08:00", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 29, 9, 30));
    const cmc = serveur({
      global: (debut, fin, intervalle) => grille(debut, fin, intervalle === "4h" ? 4 * HEURE : HEURE, () => 1e12),
      pieces: piecesDixPourcent(Date.UTC(2026, 9, 29, 8)),
    });
    const cb = vi.fn();
    const arreter = abonnerDominance("4h", cb, { fetcher: cmc.fetcher });

    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
    expect(cmc.mock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]?.[0]).toMatchObject({ time: Date.UTC(2026, 9, 29, 8), open: 10, close: 10 });
    const globaux = cmc.appels().filter((url) => url.pathname.includes("global-metrics"));
    expect(globaux.map((url) => url.searchParams.get("interval"))).toEqual(["4h"]);
    for (const id of IDS) {
      expect(cmc.appelsPiece(id).map((url) => url.searchParams.get("interval"))).toEqual(["1h"]);
    }
    arreter();
  });

  it("1d : cadence de 15 min ; bucket courant absent (retard amont) → rien ; dès que le global publie le jour → émission", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(MAINTENANT);
    let finGlobal = J28;
    const cmc = serveur({
      // Le global n'a pas encore publié le 29/10 : la dernière bougie serait celle du 28/10, déjà close.
      global: (debut, fin) => grille(debut, Math.min(fin, finGlobal), JOUR, () => 1e12),
      pieces: piecesDixPourcent(J28),
    });
    const cb = vi.fn();
    const arreter = abonnerDominance("1d", cb, { fetcher: cmc.fetcher });

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(cmc.mock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(cmc.mock).toHaveBeenCalled();
    expect(cb).not.toHaveBeenCalled();

    finGlobal = J29; // contrôle positif : la nouvelle valeur arrive
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]?.[0]).toMatchObject({ time: J29, open: 10, close: 10, closed: false });
    // Pièces brutes depuis début − 3 j : la ligne de D−1 donne le point de D, report de 2 j compris.
    for (const id of IDS) expect(secondes(cmc.appelsPiece(id).at(-1), "timeStart")).toBe(J27 - 3 * JOUR);
    arreter();
  });

  describe("≥ 1d : la bougie émise est la dernière bougie de bougiesDominance au même instant (valeurs journalières distinctes)", () => {
    const jour = (t: number) => Math.round(t / JOUR);
    const totalVariable = (t: number) => 1e12 * (1 + 0.013 * (jour(t) % 7));
    const capsVariables: Record<IdPiece, (t: number) => number> = {
      825: (t) => 60e9 * (1 + 0.004 * (jour(t) % 5)),
      3408: (t) => 30e9 * (1 + 0.006 * (jour(t) % 3)),
      4943: (t) => 10e9 * (1 + 0.01 * (jour(t) % 4)),
    };
    // Prix variables : la reconstitution V2 diffère du repli V1.
    const prixVariable = (t: number) => 1 + 0.0007 * ((jour(t) % 5) - 2);
    const servir = () => serveur({
      global: (debut, fin) => grille(debut, Math.min(fin, J29), JOUR, totalVariable),
      pieces: Object.fromEntries(IDS.map((id) => [id, (debut: number, fin: number) =>
        grille(Math.max(debut, LANCEMENTS_PAR_ID[id]), Math.min(fin, J28), JOUR, capsVariables[id]).map(([t, cap]) => [t, cap, prixVariable(t)] as const)])),
    });

    it.each(["1d", "1w", "1M", "12M"] as const)("%s : repoll du jeudi 29/10/2026 09:45 = dernière bougie de l'historique", async (tf) => {
      const instant = Date.UTC(2026, 9, 29, 9, 45);
      const snapshots: McapSnapshot[] = [];
      for (let t = Date.UTC(2025, 5, 1); t <= J29; t += JOUR) snapshots.push(snapshot(t, totalVariable(t)));
      const historique = await bougiesDominance(tf, {}, { fetcher: servir().fetcher, maintenant: () => instant, chargerHistorique: async () => snapshots });

      vi.useFakeTimers();
      vi.setSystemTime(Date.UTC(2026, 9, 29, 9, 30));
      const cb = vi.fn();
      const arreter = abonnerDominance(tf, cb, { fetcher: servir().fetcher });
      await vi.advanceTimersByTimeAsync(15 * 60_000);
      arreter();

      expect(cb).toHaveBeenCalledTimes(1);
      const emise = cb.mock.calls[0]?.[0] as Candle;
      expect(ohlc(emise)).toEqual(ohlc(historique.at(-1)));
      expect(emise.open).not.toBe(emise.close);
      if (tf !== "1d") expect(emise.high).not.toBe(emise.low); // plusieurs jours agrégés
    });
  });

  it("repoll en échec : un seul console.warn par série d'échecs (remis à zéro au succès), jamais à chaque tick", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 29, 9, 30));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pieces = piecesDixPourcent(Date.UTC(2026, 9, 29, 8));
    const usdc = pieces[3408];
    delete pieces[3408];
    const cmc = serveur({ global: (debut, fin) => grille(debut, fin, HEURE, () => 1e12), pieces });
    const cb = vi.fn();
    const arreter = abonnerDominance("1h", cb, { fetcher: cmc.fetcher });

    await vi.advanceTimersByTimeAsync(3 * 5 * 60_000); // trois échecs
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toBe("[AXIOM] STABLE.D : repoll CMC en échec — bougie courante non rafraîchie");
    expect(warn.mock.calls[0]?.[1]).toMatchObject({ message: "CoinMarketCap public erreur 500" });

    pieces[3408] = usdc; // CMC rétabli : émission, le drapeau retombe
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(cb).toHaveBeenCalledTimes(1);

    delete pieces[3408]; // nouvelle série d'échecs : un nouveau signal, un seul
    await vi.advanceTimersByTimeAsync(2 * 5 * 60_000);
    expect(warn).toHaveBeenCalledTimes(2);
    arreter();
  });
});

describe("chemin de PRODUCTION (aucune dépendance injectée, module neuf) : dédoublonnage, reprise, rafales", () => {
  /** Module NEUF : pages en vol, chargement journalier partagé et file d'attente vierges. */
  async function moduleNeuf() {
    vi.resetModules();
    return import("./dominanceStablecoins");
  }

  const hier = () => Math.floor(Date.now() / JOUR) * JOUR - JOUR;
  const heurePrecedente = () => Math.floor(Date.now() / HEURE) * HEURE - HEURE;
  /** Faux CMC « temps réel » : global jusqu'à maintenant, pièces un pas derrière, ETH (1027) pour chargerHistoriqueCmc. */
  function serveurProduction() {
    const pas = (intervalle: string) => (intervalle === "1h" ? HEURE : intervalle === "4h" ? 4 * HEURE : JOUR);
    const piece = (lancement: number, cap: number): Serie => (debut, fin, intervalle) =>
      grille(Math.max(debut, lancement), Math.min(fin, intervalle === "1h" ? heurePrecedente() : hier()), pas(intervalle) === HEURE ? HEURE : JOUR, () => cap);
    const pieces: Partial<Record<number, Serie>> = {
      825: piece(LANCEMENTS_STABLECOINS_CMC.USDT, 60e9),
      3408: piece(LANCEMENTS_STABLECOINS_CMC.USDC, 30e9),
      4943: piece(LANCEMENTS_STABLECOINS_CMC.DAI, 10e9),
      1027: piece(Date.UTC(2015, 7, 7), 1e11),
    };
    return { pieces, ...serveur({ global: (debut, fin, intervalle) => grille(debut, Math.min(fin, Date.now()), pas(intervalle), () => 1e12), pieces }) };
  }

  it("1d et 1w simultanés : un seul chargement journalier (3 requêtes de pièces)", async () => {
    const { bougiesDominance: bougies } = await moduleNeuf();
    const cmc = serveurProduction();
    vi.stubGlobal("fetch", cmc.fetcher);

    const [d, w] = await Promise.all([bougies("1d"), bougies("1w")]);

    expect(d.at(-1)?.close).toBeCloseTo(10, 9);
    expect(w.at(-1)?.close).toBeCloseTo(10, 9);
    for (const id of IDS) expect(cmc.appelsPiece(id), `id ${id}`).toHaveLength(1);
  });

  it("1d : un échec n'est pas gardé (pas de cache) ; CMC rétabli, le nouvel essai re-requête et réussit", async () => {
    const { bougiesDominance: bougies } = await moduleNeuf();
    const cmc = serveurProduction();
    vi.stubGlobal("fetch", cmc.fetcher);
    const dai = cmc.pieces[4943];

    delete cmc.pieces[4943];
    await expect(bougies("1d")).rejects.toMatchObject({ name: "ErreurDominanceStablecoins" });
    const avant = cmc.appelsPiece(4943).length;
    cmc.pieces[4943] = dai;
    const reprise = await bougies("1d");

    expect(cmc.appelsPiece(4943).length).toBeGreaterThan(avant);
    expect(reprise.at(-1)?.close).toBeCloseTo(10, 9);
  });

  it("1h : une page en échec n'est pas gardée (même clé) : le nouvel essai repart sur le réseau et réussit", async () => {
    const { bougiesDominance: bougies } = await moduleNeuf();
    const cmc = serveurProduction();
    vi.stubGlobal("fetch", cmc.fetcher);
    const usdc = cmc.pieces[3408];
    const fin = Math.floor(Date.now() / HEURE) * HEURE - 3 * HEURE;

    delete cmc.pieces[3408];
    await expect(bougies("1h", { endTime: fin, limit: 3 })).rejects.toMatchObject({ name: "ErreurDominanceStablecoins" });
    const avant = cmc.appels().length;
    cmc.pieces[3408] = usdc;
    const reprise = await bougies("1h", { endTime: fin, limit: 3 });

    expect(cmc.appels().length).toBeGreaterThan(avant);
    expect(reprise.map((b) => b.close)).toEqual([10, 10, 10]);
  });

  it("deux demandes simultanées de la même page partagent leurs 4 requêtes (global + 3 pièces)", async () => {
    const { bougiesDominance: bougies } = await moduleNeuf();
    const cmc = serveurProduction();
    vi.stubGlobal("fetch", cmc.fetcher);
    const fin = Math.floor(Date.now() / HEURE) * HEURE - 3 * HEURE;

    const [premiere, seconde] = await Promise.all([bougies("1h", { endTime: fin, limit: 3 }), bougies("1h", { endTime: fin, limit: 3 })]);

    expect(seconde).toEqual(premiere);
    expect(premiere.map((b) => b.close)).toEqual([10, 10, 10]);
    expect(cmc.mock).toHaveBeenCalledTimes(4);
  });

  /** Fetcher qui retient chaque réponse une macrotâche : la concurrence devient observable. */
  function compteurEnVol(fetcher: typeof fetch) {
    const etat = { enVol: 0, max: 0 };
    const enrobe = (async (input: RequestInfo | URL, init?: RequestInit) => {
      etat.max = Math.max(etat.max, ++etat.enVol);
      try {
        await new Promise((resoudre) => setTimeout(resoudre, 2));
        return await fetcher(input, init);
      } finally {
        etat.enVol -= 1;
      }
    }) as typeof fetch;
    return { etat, enrobe };
  }

  it("rafale (EVTS en 1h) : 12 pages distinctes simultanées → au plus 2 pages, soit 8 requêtes CMC en vol, toutes résolues", async () => {
    const { bougiesDominance: bougies } = await moduleNeuf();
    const cmc = serveurProduction();
    const { etat, enrobe } = compteurEnVol(cmc.fetcher);
    vi.stubGlobal("fetch", enrobe);
    const fin = Math.floor(Date.now() / HEURE) * HEURE - 3 * HEURE;

    const pages = await Promise.all(Array.from({ length: 12 }, (_, i) => bougies("1h", { endTime: fin - i * 10 * HEURE, limit: 3 })));

    expect(etat.max).toBe(8);
    expect(cmc.mock).toHaveBeenCalledTimes(48);
    for (const page of pages) expect(page.map((b) => b.close)).toEqual([10, 10, 10]);
  });

  it("le dédoublonnage passe avant la file : [A, A, B] → A et B en vol ensemble (8 requêtes), le doublon ne prend pas de place", async () => {
    const { bougiesDominance: bougies } = await moduleNeuf();
    const cmc = serveurProduction();
    const { etat, enrobe } = compteurEnVol(cmc.fetcher);
    vi.stubGlobal("fetch", enrobe);
    const fin = Math.floor(Date.now() / HEURE) * HEURE - 3 * HEURE;

    await Promise.all([
      bougies("1h", { endTime: fin, limit: 3 }),
      bougies("1h", { endTime: fin, limit: 3 }),
      bougies("1h", { endTime: fin - 10 * HEURE, limit: 3 }),
    ]);

    expect(etat.max).toBe(8);
    expect(cmc.mock).toHaveBeenCalledTimes(8);
  });

  it("une page en échec libère sa place : la file continue jusqu'au bout", async () => {
    const { bougiesDominance: bougies } = await moduleNeuf();
    const cmc = serveurProduction();
    const fin = Math.floor(Date.now() / HEURE) * HEURE - 3 * HEURE;
    // Les deux pages les plus anciennes échouent (erreur CMC en HTTP 200) ; elles partent en premier.
    const { enrobe } = compteurEnVol((async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      return secondes(url, "timeEnd") < fin - 15 * HEURE ? reponse(ERREUR_CMC) : cmc.fetcher(input, init);
    }) as typeof fetch);
    vi.stubGlobal("fetch", enrobe);

    const issues = await Promise.allSettled([30, 20, 10, 0].map((decalage) => bougies("1h", { endTime: fin - decalage * HEURE, limit: 3 })));

    expect(issues.map((issue) => issue.status)).toEqual(["rejected", "rejected", "fulfilled", "fulfilled"]);
  });
});
