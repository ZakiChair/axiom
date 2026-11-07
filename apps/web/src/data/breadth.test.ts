import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScreenerRow } from "./screener";
import {
  cacheEstFrais,
  calculerAd,
  calculerAuDessusMm,
  calculerHistoriqueLargeur,
  conserverDerniersJours,
  estSymboleExclu,
  fetchBreadth,
  filtrerUnivers,
  JOURS_HISTORIQUE,
  ligneAdCumulee,
  parserKlinesFermees,
  partsSerie,
  resumerBreadth,
  type CloturesDatees,
  type HistoriqueLargeur,
  type ResumBreadth,
} from "./breadth";

/** Fabrique minimale d'une ligne d'univers (seuls symbole/volume/Δ24h comptent ici). */
function ligne(symbol: string, volumeUsd24h: number, priceChangePct24h = 0): ScreenerRow {
  return { symbol, quote: "USDT", lastPrice: 1, priceChangePct24h, volumeUsd24h };
}

// ─────────────────────────── calculerAuDessusMm ───────────────────────────

describe("calculerAuDessusMm", () => {
  it("renvoie null quand il y a moins de `longueur` clôtures", () => {
    expect(calculerAuDessusMm([1, 2, 3], 5)).toBeNull();
    expect(calculerAuDessusMm([], 1)).toBeNull();
  });

  it("compare la dernière clôture à la SMA des `longueur` dernières (au-dessus)", () => {
    // SMA(2,4,6) = 4 ; dernière clôture 6 > 4 → true.
    expect(calculerAuDessusMm([2, 4, 6], 3)).toBe(true);
  });

  it("renvoie false quand la dernière clôture est sous la SMA", () => {
    // SMA(10,8,3) = 7 ; dernière clôture 3 < 7 → false.
    expect(calculerAuDessusMm([10, 8, 3], 3)).toBe(false);
  });

  it("n'utilise QUE les `longueur` dernières clôtures (fenêtre glissante)", () => {
    // longueur 3 sur [100,100,3,3,6] → SMA(3,3,6)=4 ; dernière 6 > 4 → true.
    expect(calculerAuDessusMm([100, 100, 3, 3, 6], 3)).toBe(true);
  });

  it("égalité stricte : clôture == SMA n'est PAS au-dessus", () => {
    // SMA(4,4,4)=4 ; dernière 4 == 4 → false (comparaison stricte >).
    expect(calculerAuDessusMm([4, 4, 4], 3)).toBe(false);
  });
});

// ─────────────────────────── Exclusions d'univers ───────────────────────────

describe("estSymboleExclu", () => {
  it("exclut les tokens à levier (suffixes UP/DOWN/BULL/BEAR)", () => {
    expect(estSymboleExclu("BTCUPUSDT")).toBe(true);
    expect(estSymboleExclu("BTCDOWNUSDT")).toBe(true);
    expect(estSymboleExclu("ETHBULLUSDT")).toBe(true);
    expect(estSymboleExclu("ETHBEARUSDT")).toBe(true);
    // Restes délistés (volume nul) nommés directement BULL/BEAR.
    expect(estSymboleExclu("BULLUSDT")).toBe(true);
    expect(estSymboleExclu("BEARUSDT")).toBe(true);
  });

  it("GARDE les vrais tokens qui percutent le suffixe UP (carve-out documenté)", () => {
    // JUP (Jupiter) et SYRUP (Maple) finissent par UPUSDT mais ne sont PAS à levier.
    expect(estSymboleExclu("JUPUSDT")).toBe(false);
    expect(estSymboleExclu("SYRUPUSDT")).toBe(false);
  });

  it("exclut les paires stable-contre-stable listées", () => {
    expect(estSymboleExclu("USDCUSDT")).toBe(true);
    expect(estSymboleExclu("FDUSDUSDT")).toBe(true);
    expect(estSymboleExclu("TUSDUSDT")).toBe(true);
  });

  it("GARDE EURUSDT (forex réel, pas stable-contre-stable)", () => {
    expect(estSymboleExclu("EURUSDT")).toBe(false);
  });

  it("garde une paire crypto normale", () => {
    expect(estSymboleExclu("BTCUSDT")).toBe(false);
    expect(estSymboleExclu("SOLUSDT")).toBe(false);
  });
});

describe("filtrerUnivers", () => {
  it("retire les lignes exclues et préserve les autres", () => {
    const rows = [
      ligne("BTCUSDT", 100),
      ligne("BTCUPUSDT", 50),
      ligne("USDCUSDT", 200),
      ligne("JUPUSDT", 30),
      ligne("EURUSDT", 40),
    ];
    const gardes = filtrerUnivers(rows).map((r) => r.symbol);
    expect(gardes).toEqual(["BTCUSDT", "JUPUSDT", "EURUSDT"]);
  });
});

// ─────────────────────────── A/D ───────────────────────────

describe("calculerAd", () => {
  it("compte hausses (Δ>0) et baisses (Δ<0), ignore l'inchangé (Δ=0)", () => {
    const rows = [
      ligne("A", 1, 2.5),
      ligne("B", 1, -1),
      ligne("C", 1, 0),
      ligne("D", 1, -0.3),
      ligne("E", 1, 5),
    ];
    expect(calculerAd(rows)).toEqual({ hausses: 2, baisses: 2 });
  });

  it("univers vide → 0/0", () => {
    expect(calculerAd([])).toEqual({ hausses: 0, baisses: 0 });
  });
});

// ─────────────────────────── resumerBreadth ───────────────────────────

describe("resumerBreadth", () => {
  it("calcule les pourcentages en excluant les null du dénominateur, dénominateurs séparés MM50/MM200", () => {
    // 3 symboles :
    //  - 210 clôtures → MM50 et MM200 calculables
    //  - 60 clôtures  → MM50 calculable, MM200 = null (exclu du dénominateur 200)
    //  - 30 clôtures  → MM50 et MM200 = null
    const hausse = (n: number) => Array.from({ length: n }, (_, i) => i + 1); // croissant → au-dessus des MM
    const parSymbole = [
      { closes: hausse(210) },
      { closes: hausse(60) },
      { closes: hausse(30) },
    ];
    const r = resumerBreadth(parSymbole, { hausses: 2, baisses: 1 }, null, 1000);
    // MM50 : dénominateur 2 (210 et 60), numérateur 2 → 100 %.
    expect(r.pctAuDessusMm50).toBe(100);
    // MM200 : dénominateur 1 (210 seul), numérateur 1 → 100 %.
    expect(r.pctAuDessusMm200).toBe(100);
  });

  it("dénominateur nul (aucune clôture exploitable) → 0, pas NaN", () => {
    const parSymbole = [{ closes: [1, 2, 3] }];
    const r = resumerBreadth(parSymbole, { hausses: 0, baisses: 0 }, null, 1000);
    expect(r.pctAuDessusMm50).toBe(0);
    expect(r.pctAuDessusMm200).toBe(0);
  });

  it("parSymbole vide → pourcentages 0 et nUnivers 0", () => {
    const r = resumerBreadth([], { hausses: 0, baisses: 0 }, null, 1000);
    expect(r.pctAuDessusMm50).toBe(0);
    expect(r.pctAuDessusMm200).toBe(0);
    expect(r.nUnivers).toBe(0);
  });

  it("nUnivers = nombre de symboles fournis ; ad et ts recopiés", () => {
    const parSymbole = [{ closes: [1] }, { closes: [2] }];
    const r = resumerBreadth(parSymbole, { hausses: 5, baisses: 3 }, null, 42);
    expect(r.nUnivers).toBe(2);
    expect(r.adJour).toEqual({ hausses: 5, baisses: 3 });
    expect(r.ts).toBe(42);
  });

  it("tendance : pctMm50Prec recopie la valeur `prec` (null au premier calcul)", () => {
    const parSymbole = [{ closes: [1] }];
    expect(resumerBreadth(parSymbole, { hausses: 0, baisses: 0 }, null, 1).pctMm50Prec).toBeNull();
    expect(resumerBreadth(parSymbole, { hausses: 0, baisses: 0 }, 55, 1).pctMm50Prec).toBe(55);
  });

  it("calcule un pourcentage partiel correct (moitié au-dessus)", () => {
    const croissant = Array.from({ length: 55 }, (_, i) => i + 1); // au-dessus MM50
    const decroissant = Array.from({ length: 55 }, (_, i) => 55 - i); // sous MM50
    const r = resumerBreadth(
      [{ closes: croissant }, { closes: decroissant }],
      { hausses: 1, baisses: 1 },
      null,
      1,
    );
    expect(r.pctAuDessusMm50).toBe(50);
  });
});

// ─────────────────────────── Cache (fraîcheur / force) ───────────────────────────

const TTL_12H = 12 * 60 * 60 * 1000;

function resum(ts: number): ResumBreadth {
  return {
    nUnivers: 50,
    pctAuDessusMm50: 60,
    pctAuDessusMm200: 40,
    adJour: { hausses: 30, baisses: 20 },
    pctMm50Prec: null,
    ts,
    historique: null,
  };
}

describe("cacheEstFrais", () => {
  it("null (pas de cache) → jamais frais", () => {
    expect(cacheEstFrais(null, 1000, false)).toBe(false);
  });

  it("cache dans la fenêtre 12 h → frais", () => {
    const now = 1_000_000_000;
    expect(cacheEstFrais(resum(now - TTL_12H + 1), now, false)).toBe(true);
  });

  it("cache au-delà de 12 h → périmé", () => {
    const now = 1_000_000_000;
    expect(cacheEstFrais(resum(now - TTL_12H - 1), now, false)).toBe(false);
  });

  it("force → jamais frais même si récent", () => {
    const now = 1_000_000_000;
    expect(cacheEstFrais(resum(now), now, true)).toBe(false);
  });

  it("cache antérieur à l'historisation (sans champ historique) → périmé même récent", () => {
    const now = 1_000_000_000;
    const ancien = { ...resum(now) } as Partial<ResumBreadth>;
    delete ancien.historique;
    expect(cacheEstFrais(ancien as ResumBreadth, now, false)).toBe(false);
  });
});

// ─────────────────────────── Historique (SUG-41) ───────────────────────────

const JOUR = 86_400_000;
const J0 = Date.UTC(2026, 0, 1);

/** Série datée : clôtures jour après jour à partir du jour `decalage` de la grille. */
function serie(symbol: string, closes: number[], decalage = 0): CloturesDatees {
  return { symbol, t: closes.map((_, i) => J0 + (decalage + i) * JOUR), closes };
}

/** Marche aléatoire déterministe (LCG) : clôtures > 0 reproductibles. */
function marche(graine: number, longueur: number, depart = 100): number[] {
  let etat = graine;
  let prix = depart;
  return Array.from({ length: longueur }, () => {
    etat = (etat * 1_103_515_245 + 12_345) % 2_147_483_648;
    prix *= 1 + (etat / 2_147_483_648 - 0.5) * 0.08;
    return prix;
  });
}

/** Kline Binance [ouverture, o, h, l, clôture, v, heure de clôture, …]. */
function kline(ouverture: number, close: number | string, heureCloture: unknown = ouverture + JOUR - 1): unknown[] {
  return [ouverture, "1", "1", "1", String(close), "10", heureCloture, "1000", 5, "5", "500", "0"];
}

/** Coupe chaque série dénombrée et le McClellan aux `n` premiers jours. */
function premiersJours(h: HistoriqueLargeur, n: number): HistoriqueLargeur {
  const couper = (s: { k: number[]; n: number[] }) => ({ k: s.k.slice(0, n), n: s.n.slice(0, n) });
  return {
    debut: h.debut,
    mm50: couper(h.mm50),
    mm200: couper(h.mm200),
    hb20: couper(h.hb20),
    hb55: couper(h.hb55),
    ad: couper(h.ad),
    mcClellan: h.mcClellan.slice(0, n),
    saison90: couper(h.saison90),
    saison30: couper(h.saison30),
  };
}

describe("parserKlinesFermees — clôtures fermées et datées", () => {
  it("écarte la bougie du jour en cours (heure de clôture non passée) et date au minuit UTC", () => {
    const maintenant = J0 + 2 * JOUR + 12 * 3_600_000;
    const raw = [kline(J0, 10), kline(J0 + JOUR, 11), kline(J0 + 2 * JOUR, 12)];
    expect(parserKlinesFermees(raw, maintenant)).toEqual({ t: [J0, J0 + JOUR], closes: [10, 11] });
  });

  it("une bougie dont la clôture tombe pile à maintenant n'est pas encore fermée ; une milliseconde après, si", () => {
    const raw = [kline(J0, 10)];
    expect(parserKlinesFermees(raw, J0 + JOUR - 1).closes).toEqual([]);
    expect(parserKlinesFermees(raw, J0 + JOUR).closes).toEqual([10]);
  });

  it("sans heure de clôture (k[6] absent ou null) : ouverture + 1 j − 1 ms", () => {
    const sansK6 = [[J0, "1", "1", "1", "10"], [J0 + JOUR, "1", "1", "1", "11", "1", null]];
    expect(parserKlinesFermees(sansK6, J0 + JOUR + 1).closes).toEqual([10]);
    expect(parserKlinesFermees(sansK6, J0 + 2 * JOUR).closes).toEqual([10, 11]);
  });

  it("ignore entrées invalides, clôtures ≤ 0 ou non finies, jours non croissants ; réponse non tableau → vide", () => {
    const raw = [
      "x",
      kline(J0, "abc"),
      kline(J0, 0),
      kline(J0 + 5, 10), // ouverture décalée : ramenée au minuit
      kline(J0, 99), // même jour : doublon écarté
      kline(J0 + JOUR, 11),
    ];
    expect(parserKlinesFermees(raw, J0 + 10 * JOUR)).toEqual({ t: [J0, J0 + JOUR], closes: [10, 11] });
    expect(parserKlinesFermees({ code: -1121 }, J0)).toEqual({ t: [], closes: [] });
  });
});

describe("calculerHistoriqueLargeur — séries de largeur jour par jour", () => {
  it("aucune clôture → null", () => {
    expect(calculerHistoriqueLargeur([])).toBeNull();
    expect(calculerHistoriqueLargeur([serie("AUSDT", [])])).toBeNull();
  });

  it("% > MM50 : un symbole ne compte qu'à partir de sa 50ᵉ clôture ; avant, le jour est non mesuré (null, pas 0 %)", () => {
    const hausse = Array.from({ length: 60 }, (_, i) => 100 + i);
    const baisse = Array.from({ length: 50 }, (_, i) => 200 - i);
    const h = calculerHistoriqueLargeur([serie("AUSDT", hausse), serie("BUSDT", baisse, 10)]);
    expect(h).not.toBeNull();
    const { mm50, debut } = h as HistoriqueLargeur;
    expect(debut).toBe(J0);
    expect(mm50.n).toHaveLength(60);
    expect(mm50.n[48]).toBe(0);
    expect(partsSerie(mm50)[48]).toBeNull();
    expect([mm50.k[49], mm50.n[49]]).toEqual([1, 1]); // A seul (B n'a que 40 clôtures)
    expect([mm50.k[59], mm50.n[59]]).toEqual([1, 2]); // B entre, sous sa MM50
    expect(partsSerie(mm50)[59]).toBe(50);
    expect(h?.mm200.n.every((n) => n === 0)).toBe(true);
  });

  it("dernier point = instantané resumerBreadth sur des séries alignées (MM50 et MM200, même sommation)", () => {
    const series = [
      serie("BTCUSDT", marche(1, 260)),
      serie("ETHUSDT", marche(2, 260)),
      serie("SOLUSDT", marche(3, 230), 30),
      serie("NEWUSDT", marche(4, 120), 140),
      serie("XRPUSDT", marche(5, 260)),
    ];
    const h = calculerHistoriqueLargeur(series) as HistoriqueLargeur;
    const instantane = resumerBreadth(series, { hausses: 0, baisses: 0 }, null, 0);
    const der = h.mm50.n.length - 1;
    expect(partsSerie(h.mm50)[der]).toBe(instantane.pctAuDessusMm50);
    expect(partsSerie(h.mm200)[der]).toBe(instantane.pctAuDessusMm200);
    expect(h.mm200.n[der]).toBe(4); // NEW (120 clôtures) hors dénominateur MM200
  });

  it("causalité par préfixe : ajouter des clôtures ne change aucun point antérieur (toutes les séries)", () => {
    const complet = [
      serie("BTCUSDT", marche(11, 320)),
      serie("ETHUSDT", marche(12, 320)),
      serie("SOLUSDT", marche(13, 300), 20),
      serie("DOGEUSDT", marche(14, 200), 120),
      serie("USDCUSDT", Array.from({ length: 320 }, () => 1)),
    ];
    const coupure = J0 + 249 * JOUR;
    const prefixe = complet.map((s) => {
      const garde = s.t.filter((t) => t <= coupure).length;
      return { symbol: s.symbol, t: s.t.slice(0, garde), closes: s.closes.slice(0, garde) };
    });
    const hComplet = calculerHistoriqueLargeur(complet) as HistoriqueLargeur;
    const hPrefixe = calculerHistoriqueLargeur(prefixe) as HistoriqueLargeur;
    expect(hPrefixe.mcClellan).toHaveLength(250);
    expect(premiersJours(hComplet, 250)).toEqual(hPrefixe);
    // Témoins : les séries comparées ne sont pas triviales.
    expect(hPrefixe.mm200.n.some((n) => n > 0)).toBe(true);
    expect(hPrefixe.saison90.n.some((n) => n > 0)).toBe(true);
    expect(hPrefixe.mcClellan.some((v) => v !== null && v !== 0)).toBe(true);
  });

  it("nouveaux plus hauts / plus bas de clôture : hausse → +1, baisse → −1, plat → 0 ; mesurés dès 20 (55) clôtures antérieures", () => {
    const n = 60;
    const h = calculerHistoriqueLargeur([
      serie("UPXUSDT", Array.from({ length: n }, (_, i) => 10 + i)),
      serie("DNXUSDT", Array.from({ length: n }, (_, i) => 100 - i)),
      serie("PLXUSDT", Array.from({ length: n }, () => 5)),
    ]) as HistoriqueLargeur;
    expect(h.hb20.n[19]).toBe(0);
    expect([h.hb20.k[20], h.hb20.n[20]]).toEqual([0, 3]); // +1 − 1 + 0
    expect(h.hb55.n[54]).toBe(0);
    expect([h.hb55.k[55], h.hb55.n[55]]).toEqual([0, 3]);
    const hausseSeule = calculerHistoriqueLargeur([
      serie("AUSDT", Array.from({ length: 30 }, (_, i) => 10 + i)),
    ]) as HistoriqueLargeur;
    expect(partsSerie(hausseSeule.hb20).slice(20)).toEqual(Array(10).fill(100));
    // Égalité avec l'ancien plus haut : pas un nouveau plus haut.
    const egal = calculerHistoriqueLargeur([
      serie("AUSDT", [...Array.from({ length: 20 }, (_, i) => i + 1), 20]),
    ]) as HistoriqueLargeur;
    expect([egal.hb20.k[20], egal.hb20.n[20]]).toEqual([0, 1]);
  });

  it("A/D top 50 : hausses − baisses vs clôture précédente ; ligne cumulée ; un jour sans aucune clôture reste un trou", () => {
    const a = serie("AUSDT", [10, 11, 12, 11]);
    const b = serie("BUSDT", [10, 9, 9, 8]);
    // Jours 4 et 5 sans aucune donnée (grille contiguë), reprise au jour 6.
    const c = { symbol: "CUSDT", t: [J0, J0 + 6 * JOUR], closes: [10, 12] };
    const h = calculerHistoriqueLargeur([a, b, c]) as HistoriqueLargeur;
    expect(h.ad.n).toEqual([0, 2, 2, 2, 0, 0, 1]);
    expect(h.ad.k).toEqual([0, 0, 1, -2, 0, 0, 1]);
    expect(ligneAdCumulee(h.ad)).toEqual([null, 0, 1, -1, null, null, 0]);
    expect(partsSerie(h.ad)[4]).toBeNull();
  });

  it("oscillateur type McClellan : null pendant l'amorce (EMA 39), 0 sur un solde constant, positif après un retournement haussier", () => {
    const constant = calculerHistoriqueLargeur([
      serie("AUSDT", Array.from({ length: 80 }, (_, i) => 10 + i)),
      serie("BUSDT", Array.from({ length: 80 }, (_, i) => 50 + i)),
    ]) as HistoriqueLargeur;
    // Premier jour mesuré : g = 1 ; EMA 39 définie au 39ᵉ jour mesuré → g = 39.
    expect(constant.mcClellan[38]).toBeNull();
    expect(constant.mcClellan[39]).toBe(0);
    expect(constant.mcClellan[79]).toBe(0);
    const retournement = calculerHistoriqueLargeur([
      serie("AUSDT", [...Array.from({ length: 60 }, (_, i) => 100 - i), ...Array.from({ length: 20 }, (_, i) => 41 + i)]),
    ]) as HistoriqueLargeur;
    expect(retournement.mcClellan[79]).toBeGreaterThan(0);
  });

  it("conserverDerniersJours : garde les N derniers jours après calcul, debut suit ; N ≥ longueur → inchangé", () => {
    const h = calculerHistoriqueLargeur([serie("AUSDT", marche(7, 300))]) as HistoriqueLargeur;
    const court = conserverDerniersJours(h, 200);
    expect(court.debut).toBe(J0 + 100 * JOUR);
    expect(court.mcClellan).toEqual(h.mcClellan.slice(100));
    expect(court.mm200.k).toEqual(h.mm200.k.slice(100));
    expect(court.saison30.n).toHaveLength(200);
    expect(conserverDerniersJours(h, 400)).toEqual(h);
  });
});

// ─────────────────────────── fetchBreadth (réseau bouchonné) ───────────────────────────

describe("fetchBreadth — mêmes requêtes, 400 klines, cache des séries dérivées seulement", () => {
  const MAINTENANT = J0 + 300 * JOUR + 6 * 3_600_000;
  let stockage: Map<string, string>;

  function installerStockage(): void {
    stockage = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => stockage.get(k) ?? null,
      setItem: (k: string, v: string) => void stockage.set(k, v),
      removeItem: (k: string) => void stockage.delete(k),
    });
  }

  /**
   * Faux Binance : ticker de 60 paires USDT (dont un stable-contre-stable et un jeton à levier,
   * exclus avant le top 50) + klines de 300 jours fermés et de la bougie du jour en cours.
   */
  function installerReseau(): ReturnType<typeof vi.fn> {
    const ticker = [
      { symbol: "USDCUSDT", lastPrice: "1", quoteVolume: "9000", priceChangePercent: "0" },
      { symbol: "BTCUPUSDT", lastPrice: "1", quoteVolume: "8000", priceChangePercent: "3" },
      { symbol: "BTCUSDT", lastPrice: "1", quoteVolume: "7000", priceChangePercent: "1" },
      ...Array.from({ length: 57 }, (_, i) => ({
        symbol: `ALT${i}USDT`,
        lastPrice: "1",
        quoteVolume: String(1000 - i),
        priceChangePercent: i % 2 === 0 ? "1" : "-1",
      })),
    ];
    const mock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/ticker/24hr")) return new Response(JSON.stringify(ticker));
      const symbole = url.searchParams.get("symbol") ?? "";
      const graine = [...symbole].reduce((acc, c) => acc * 31 + c.charCodeAt(0), 7) % 1_000_003;
      const closes = marche(graine, 301);
      return new Response(JSON.stringify(closes.map((c, i) => kline(J0 + i * JOUR, c))));
    });
    vi.stubGlobal("fetch", mock);
    return mock;
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("demande 400 klines par symbole, écarte la bougie en cours et ne met en cache que des comptes dérivés", async () => {
    installerStockage();
    const mock = installerReseau();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(MAINTENANT);
    const r = await fetchBreadth();
    const urlsKlines = mock.mock.calls
      .map(([u]) => new URL(String(u)))
      .filter((u) => u.pathname.endsWith("/klines"));
    expect(urlsKlines).toHaveLength(50); // top 50 après exclusions (USDCUSDT, BTCUPUSDT)
    expect(urlsKlines.every((u) => u.searchParams.get("limit") === "400")).toBe(true);
    const h = r?.historique as HistoriqueLargeur;
    expect(h.mcClellan).toHaveLength(JOURS_HISTORIQUE);
    // Dernier jour = la veille : la bougie du jour 300, en cours, n'est jamais lue.
    expect(h.debut + (JOURS_HISTORIQUE - 1) * JOUR).toBe(J0 + 299 * JOUR);
    expect(h.saison90.n.at(-1)).toBe(49); // 49 alts face à BTC
    const brut = stockage.get("axiom:breadth:v1") ?? "";
    expect(brut).not.toContain("closes");
    expect(brut.length).toBeLessThan(15_000); // ≈ 10 Ko pour 50 symboles, contre ≈ 200 Ko de clôtures
    expect(JSON.parse(brut)).toEqual(r);
  });

  it("horloge locale en avance de 2 h : la bougie du jour, renvoyée en dernier, n'est jamais lue", async () => {
    installerStockage();
    installerReseau(); // le serveur est le jour 300 à 23:00 UTC : sa bougie 300 est en cours
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(J0 + 301 * JOUR + 3_600_000); // 01:00 le lendemain, selon le navigateur
    const r = await fetchBreadth();
    const h = r?.historique as HistoriqueLargeur;
    expect(h.debut + (JOURS_HISTORIQUE - 1) * JOUR).toBe(J0 + 299 * JOUR);
  });

  it("un cache antérieur à l'historique est recalculé une fois, sa MM50 sert de tendance ; un historique corrompu aussi", async () => {
    installerStockage();
    const mock = installerReseau();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(MAINTENANT);
    const ancien = { ...resum(MAINTENANT - 1000), pctAuDessusMm50: 42 } as Partial<ResumBreadth>;
    delete ancien.historique;
    stockage.set("axiom:breadth:v1", JSON.stringify(ancien));
    const r = await fetchBreadth();
    expect(r?.pctMm50Prec).toBe(42);
    expect(r?.historique).not.toBeNull();

    // Cache frais : aucun appel.
    const appelsFrais = mock.mock.calls.length;
    await fetchBreadth();
    expect(mock.mock.calls.length).toBe(appelsFrais);

    // Historique de forme invalide (compte non entier, séries manquantes) : recalcul.
    stockage.set(
      "axiom:breadth:v1",
      JSON.stringify({ ...r, historique: { debut: 1, mcClellan: [null], mm50: { k: [0.5], n: [1] } } }),
    );
    const r2 = await fetchBreadth();
    expect(mock.mock.calls.length).toBeGreaterThan(appelsFrais);
    expect(r2?.historique?.mcClellan).toHaveLength(JOURS_HISTORIQUE);
  });

  it("ticker en échec : cache périmé servi, historique absent normalisé à null", async () => {
    installerStockage();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    const ancien = { ...resum(1) } as Partial<ResumBreadth>;
    delete ancien.historique;
    stockage.set("axiom:breadth:v1", JSON.stringify(ancien));
    const r = await fetchBreadth();
    expect(r?.historique).toBeNull();
    expect(r?.pctAuDessusMm50).toBe(60);
  });
});
