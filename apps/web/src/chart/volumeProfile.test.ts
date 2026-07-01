/**
 * Tests de computeVolumeProfile (VPVR) — moteur pur qui pilote le panneau Volume
 * Profile. Couvre : répartition uniforme du volume d'une bougie sur les bins
 * couverts, détection du POC, repli buy/sell quand buyVolume/sellVolume sont
 * absents, et comportement du tie-break de la Value Area à égalité stricte.
 */
import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeVolumeProfile } from "./volumeProfile";

function candle(partial: Partial<Candle> & Pick<Candle, "low" | "high" | "volume">): Candle {
  return { time: 0, open: 0, close: 0, ...partial };
}

function bin(vp: ReturnType<typeof computeVolumeProfile>, index: number) {
  const b = vp?.bins[index];
  if (!b) throw new Error(`bin ${index} introuvable`);
  return b;
}

describe("computeVolumeProfile", () => {
  it("répartit le volume d'une bougie uniformément sur les bins qu'elle couvre", () => {
    // [100,200) sur 5 bins de 20 => couvre les 5 bins, 100/5 = 20 chacun.
    const candles = [candle({ low: 100, high: 200, volume: 100, open: 140, close: 160 })];
    const vp = computeVolumeProfile(candles, 0, 1, 5);
    expect(vp).not.toBeNull();
    for (let i = 0; i < 5; i++) {
      expect(bin(vp, i).volume).toBeCloseTo(20);
    }
    const total = vp?.bins.reduce((s, b) => s + b.volume, 0) ?? 0;
    expect(total).toBeCloseTo(100);
  });

  it("place le POC sur le bin qui concentre le plus de volume", () => {
    // 3 bins de largeur 100 sur [0,300). Bin du milieu = pic à 1000, voisins à 10.
    const candles = [
      candle({ low: 130, high: 140, volume: 1000, open: 130, close: 140 }), // bin 1 (POC)
      candle({ low: 0, high: 300, volume: 40, open: 0, close: 300 }), // étalé sur les 3 bins
    ];
    const vp = computeVolumeProfile(candles, 0, 2, 3);
    expect(vp).not.toBeNull();
    expect(vp?.pocIndex).toBe(1);
    expect(bin(vp, 1).volume).toBeGreaterThan(bin(vp, 0).volume);
    expect(bin(vp, 1).volume).toBeGreaterThan(bin(vp, 2).volume);
  });

  it("repli buy/sell sur le sens de la bougie quand buyVolume/sellVolume sont absents", () => {
    const bullish = [candle({ low: 100, high: 110, volume: 50, open: 100, close: 110 })];
    const vpBull = computeVolumeProfile(bullish, 0, 1, 1);
    expect(bin(vpBull, 0).buyVol).toBeCloseTo(50);
    expect(bin(vpBull, 0).sellVol).toBeCloseTo(0);

    const bearish = [candle({ low: 100, high: 110, volume: 50, open: 110, close: 100 })];
    const vpBear = computeVolumeProfile(bearish, 0, 1, 1);
    expect(bin(vpBear, 0).buyVol).toBeCloseTo(0);
    expect(bin(vpBear, 0).sellVol).toBeCloseTo(50);
  });

  it("utilise buyVolume/sellVolume explicites quand présents (pas de repli)", () => {
    const candles = [
      candle({ low: 100, high: 110, volume: 50, open: 110, close: 100, buyVolume: 35, sellVolume: 15 }),
    ];
    const vp = computeVolumeProfile(candles, 0, 1, 1);
    expect(bin(vp, 0).buyVol).toBeCloseTo(35);
    expect(bin(vp, 0).sellVol).toBeCloseTo(15);
  });

  it("tie-break de la Value Area : à égalité stricte, l'expansion favorise le bin du HAUT (upVol >= dnVol)", () => {
    // priceMin=0/priceMax=300 (bornes posées par les bougies 0 et 2) => 3 bins ronds
    // de largeur 100 : [0,100), [100,200), [200,300). POC=40 (bin1), voisins 30/30 (égalité).
    // target = 70 % de 100 = 70. POC seul (40) < 70 => une expansion nécessaire.
    // upVol(30) >= dnVol(30) => le bin du HAUT (bin2) est pris, pas celui du bas (bin0).
    const candles = [
      candle({ low: 110, high: 190, volume: 40, open: 110, close: 190 }), // bin 1 (POC)
      candle({ low: 0, high: 90, volume: 30, open: 0, close: 90 }), // bin 0
      candle({ low: 210, high: 300, volume: 30, open: 210, close: 300 }), // bin 2
    ];
    const vp = computeVolumeProfile(candles, 0, 3, 3);
    expect(vp).not.toBeNull();
    expect(vp?.pocIndex).toBe(1);
    // lo n'a PAS bougé (toujours le POC) : vaLow reste la borne basse du bin 1.
    expect(vp?.vaLow).toBeCloseTo(100);
    // hi a été étendu jusqu'au bin 2 : vaHigh atteint sa borne haute.
    expect(vp?.vaHigh).toBeCloseTo(300);
  });

  it("renvoie null hors plage de prix valide (toutes bougies plates ou plage vide)", () => {
    expect(computeVolumeProfile([], 0, 0, 10)).toBeNull();
  });
});
