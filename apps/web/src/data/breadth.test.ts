import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ScreenerRow } from "./screener";
import {
  cacheEstFrais,
  calculerAd,
  calculerAuDessusMm,
  estSymboleExclu,
  filtrerUnivers,
  resumerBreadth,
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
});
