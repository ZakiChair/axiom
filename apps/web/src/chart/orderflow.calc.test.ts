/**
 * Couverture du cœur de calcul pur de l'orderflow (extrait de orderflow.ts).
 * computeCvd est déjà couvert par orderflow.cvd.test.ts ; on complète ici les deux
 * fonctions pures qui n'avaient PAS de test dédié : buildFootprintBar (POC / zone de
 * valeur 70 % / delta) et buildCvdSpotPerpBuckets (re-base à l'origine perp).
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import {
  buildCvdSpotPerpBuckets,
  buildFootprintBar,
  buildFootprintBarApprochee,
  computeCvd,
  sourceFournitCvd,
  type FpCell,
} from "./orderflow.calc";

function candle(time: number, buy: number, sell: number): Candle {
  return {
    time,
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: buy + sell,
    buyVolume: buy,
    sellVolume: sell,
    closed: true,
  };
}

describe("buildFootprintBar", () => {
  it("trie les niveaux, calcule le delta et place le POC au volume total max", () => {
    // 3 niveaux au bucketSize=1 : index 100/101/102.
    const cells = new Map<number, FpCell>([
      [102, { buy: 1, sell: 1 }], // total 2
      [100, { buy: 2, sell: 1 }], // total 3
      [101, { buy: 8, sell: 4 }], // total 12 → POC
    ]);
    const bar = buildFootprintBar(1_000, cells, 1);

    // Rows triées par prix croissant.
    expect(bar.rows.map((r) => r.price)).toEqual([100, 101, 102]);
    // Delta = Σ(buy − sell) = (2-1)+(8-4)+(1-1) = 5.
    expect(bar.delta).toBe(5);
    // POC = niveau au volume total max (101).
    expect(bar.poc).toBe(101);
    expect(bar.time).toBe(1_000);
  });

  it("étend la zone de valeur 70 % autour du POC vers le voisin le plus volumineux", () => {
    // POC net à 200 ; total = 100. Cible 70 = 70. Après POC(60), le voisin le plus
    // gros est 201(25) → 85 ≥ 70, VA = [200, 201].
    const cells = new Map<number, FpCell>([
      [199, { buy: 5, sell: 5 }], // 10
      [200, { buy: 30, sell: 30 }], // 60 → POC
      [201, { buy: 15, sell: 10 }], // 25
      [202, { buy: 3, sell: 2 }], // 5
    ]);
    const bar = buildFootprintBar(2_000, cells, 1);
    expect(bar.poc).toBe(200);
    expect(bar.val).toBe(200); // borne basse de la zone de valeur
    expect(bar.vah).toBe(201); // borne haute
    expect(bar.delta).toBe(5 - 5 + 0 + 5 + 1); // 0+0+5+1 = 6
  });

  it("gère une carte vide sans planter (poc/val/vah = 0)", () => {
    const bar = buildFootprintBar(3_000, new Map(), 1);
    expect(bar.rows).toEqual([]);
    expect(bar.delta).toBe(0);
    expect(bar.poc).toBe(0);
  });
});

describe("buildCvdSpotPerpBuckets", () => {
  it("re-base spot et perp à 0 sur la première bougie à delta perp connu", () => {
    const candles = [
      candle(1_000, 10, 2), // pas de delta perp → ignorée (avant l'origine)
      candle(2_000, 5, 1), // 1er delta perp → origine
      candle(3_000, 3, 4),
    ];
    const perp = new Map<number, number>([
      [2_000, 7],
      [3_000, -2],
    ]);
    const buckets = buildCvdSpotPerpBuckets(candles, perp);

    // Démarre à l'origine 2_000, pas à 1_000.
    expect(buckets.map((b) => b.time)).toEqual([2_000, 3_000]);
    // Spot cumulé depuis l'origine : (5-1)=4 puis +(3-4)=3.
    expect(buckets.map((b) => b.spot)).toEqual([4, 3]);
    // Perp cumulé : 7 puis 7+(-2)=5.
    expect(buckets.map((b) => b.perp)).toEqual([7, 5]);
  });

  it("retourne [] si aucune bougie n'a de delta perp", () => {
    const candles = [candle(1_000, 1, 1), candle(2_000, 2, 2)];
    expect(buildCvdSpotPerpBuckets(candles, new Map())).toEqual([]);
  });
});

describe("computeCvd — bougies SANS split buy/sell (Kraken/OKX/Bybit/HL, hist. Coinbase)", () => {
  it("contribue un delta 0 (CVD plat), pas −volume", () => {
    // Bougie sans buyVolume/sellVolume : avant correctif, buy=0 et sell=volume → −volume cumulé.
    const sansSplit: Candle = {
      time: 1_000, open: 100, high: 110, low: 90, close: 105, volume: 42, closed: true,
    };
    expect(computeCvd([sansSplit, { ...sansSplit, time: 2_000 }])).toEqual([0, 0]);
    // Une bougie AVEC split garde son delta réel.
    expect(computeCvd([candle(1_000, 10, 4)])).toEqual([6]);
  });
});

describe("buildFootprintBarApprochee", () => {
  it("répartit l'OHLCV uniformément sur la plage et conserve le delta de bougie", () => {
    // low 100 → high 102, bucket 1 : 3 niveaux ; buy 6 / sell 3 répartis uniformément.
    const bar = buildFootprintBarApprochee(1_000, { low: 100, high: 102, volume: 9, buyVolume: 6, sellVolume: 3 }, 1);
    expect(bar).not.toBeNull();
    expect(bar!.rows.map((r) => r.price)).toEqual([100, 101, 102]);
    expect(bar!.delta).toBeCloseTo(3, 10); // Σ(buy − sell) = 6 − 3
    expect(bar!.rows[0]?.buyVol).toBeCloseTo(2, 10); // 6 / 3 niveaux
  });

  it("sans split buy/sell, répartit 50/50 (delta 0) — approximation assumée", () => {
    const bar = buildFootprintBarApprochee(1_000, { low: 100, high: 100.5, volume: 8 }, 1);
    expect(bar).not.toBeNull();
    expect(bar!.delta).toBeCloseTo(0, 10);
  });

  it("renvoie null pour une bougie sans volume (rien à dessiner)", () => {
    expect(buildFootprintBarApprochee(1_000, { low: 100, high: 102, volume: 0 }, 1)).toBeNull();
  });
});

describe("sourceFournitCvd", () => {
  it("vrai UNIQUEMENT pour binance (seule source au split historique complet)", () => {
    expect(sourceFournitCvd("binance")).toBe(true);
    for (const ex of ["kraken", "okx", "bybit", "hyperliquid", "coinbase", "mexc", "twelvedata", "synthetic"] as const) {
      expect(sourceFournitCvd(ex)).toBe(false);
    }
  });
});
