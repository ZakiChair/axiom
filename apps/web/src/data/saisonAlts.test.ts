import { describe, expect, it } from "vitest";
import type { CloturesDatees } from "./breadth";
import {
  baseUsdt,
  calculerSaisonAlts,
  estAltEligible,
  SEUIL_SAISON_ALTS,
  SEUIL_SAISON_BTC,
  zoneSaison,
} from "./saisonAlts";

const JOUR = 86_400_000;
const J0 = Date.UTC(2026, 0, 1);

/** Série datée jour après jour à partir du jour `decalage` de la grille. */
function serie(symbol: string, closes: number[], decalage = 0): CloturesDatees {
  return { symbol, t: closes.map((_, i) => J0 + (decalage + i) * JOUR), closes };
}

/** Clôtures linéaires de `depart` à `fin` sur `longueur` jours. */
function lineaire(depart: number, fin: number, longueur: number): number[] {
  return Array.from({ length: longueur }, (_, i) => depart + ((fin - depart) * i) / (longueur - 1));
}

describe("univers des alts (paires USDT du top 50)", () => {
  it("base d'une paire USDT, null pour une autre cotation", () => {
    expect(baseUsdt("SOLUSDT")).toBe("SOL");
    expect(baseUsdt("solusdt")).toBe("SOL");
    expect(baseUsdt("USDT")).toBeNull();
    expect(baseUsdt("ETHBTC")).toBeNull();
  });

  it("exclut BTC, les stables et emballés des listes CORR, l'euro, les stables Binance et l'or tokenisé", () => {
    for (const exclu of ["BTCUSDT", "USDCUSDT", "FDUSDUSDT", "USDEUSDT", "USD1USDT", "WBTCUSDT", "WBETHUSDT", "BNSOLUSDT", "EURUSDT", "EURIUSDT", "XUSDUSDT", "PAXGUSDT", "ETHBTC"]) {
      expect(estAltEligible(exclu), exclu).toBe(false);
    }
    for (const alt of ["ETHUSDT", "SOLUSDT", "JUPUSDT", "DOGEUSDT", "BNBUSDT"]) {
      expect(estAltEligible(alt), alt).toBe(true);
    }
  });
});

describe("calculerSaisonAlts — part des alts qui battent BTC sur H jours", () => {
  it("compte les alts dont la performance sur H jours dépasse STRICTEMENT celle de BTC ; stables et emballés hors dénominateur", () => {
    const n = 91;
    const series = [
      serie("BTCUSDT", lineaire(100, 110, n)), // +10 %
      serie("ETHUSDT", lineaire(10, 12, n)), // +20 % → bat BTC
      serie("SOLUSDT", lineaire(10, 10.5, n)), // +5 % → ne bat pas
      serie("DOGEUSDT", lineaire(1, 1.1, n)), // +10 % : égalité → ne bat pas
      serie("USDCUSDT", lineaire(1, 1, n)),
      serie("WBTCUSDT", lineaire(100, 120, n)),
    ];
    const s = calculerSaisonAlts(series, J0, n, 90);
    expect(s.n.slice(0, 90).every((v) => v === 0)).toBe(true); // pas de clôture à D − 90
    expect([s.k[90], s.n[90]]).toEqual([1, 3]);
  });

  it("dénominateur mouvant : une alt sans clôture à D − H n'entre pas ; BTC absent → jour non mesuré", () => {
    const series = [
      serie("BTCUSDT", lineaire(100, 100, 40)),
      serie("ETHUSDT", lineaire(10, 20, 40)),
      serie("NEWUSDT", lineaire(1, 3, 20), 20), // cotée au jour 20
    ];
    const s = calculerSaisonAlts(series, J0, 50, 30);
    expect([s.k[30], s.n[30]]).toEqual([1, 1]); // NEW n'a pas 30 jours
    expect([s.k[39], s.n[39]]).toEqual([1, 1]);
    // Jours 40 à 49 : BTC absent → non mesuré (n = 0), jamais 0 %.
    expect(s.n.slice(40)).toEqual(Array(10).fill(0));
    const sansBtc = calculerSaisonAlts([serie("ETHUSDT", lineaire(10, 20, 40))], J0, 40, 30);
    expect(sansBtc.n.every((v) => v === 0)).toBe(true);
  });

  it("lit les jours calendaires D et D − H (pas les index) : un trou dans une série l'écarte ce jour-là seulement", () => {
    const btc = serie("BTCUSDT", lineaire(100, 100, 40));
    const alt = serie("ETHUSDT", lineaire(10, 20, 40));
    // Trou au jour 5 dans ETH : le jour 35 (D − 30 = 5) n'est pas mesurable pour ETH.
    const troue = { symbol: "ETHUSDT", t: alt.t.filter((_, i) => i !== 5), closes: alt.closes.filter((_, i) => i !== 5) };
    const s = calculerSaisonAlts([btc, troue], J0, 40, 30);
    expect(s.n[35]).toBe(0);
    expect([s.k[36], s.n[36]]).toEqual([1, 1]);
  });

  it("causalité par préfixe : ajouter des clôtures après D ne change pas le point de D", () => {
    const longueur = 140;
    const series = [
      serie("BTCUSDT", lineaire(100, 90, longueur)),
      serie("ETHUSDT", Array.from({ length: longueur }, (_, i) => 10 + Math.sin(i / 7) * 2)),
      serie("SOLUSDT", Array.from({ length: longueur }, (_, i) => 20 + Math.cos(i / 9) * 3)),
    ];
    const complet = calculerSaisonAlts(series, J0, longueur, 90);
    const prefixe = calculerSaisonAlts(
      series.map((s) => ({ symbol: s.symbol, t: s.t.slice(0, 100), closes: s.closes.slice(0, 100) })),
      J0,
      100,
      90,
    );
    expect({ k: complet.k.slice(0, 100), n: complet.n.slice(0, 100) }).toEqual(prefixe);
    expect(prefixe.n.some((v) => v > 0)).toBe(true);
  });
});

describe("zoneSaison — convention 75 / 25, pas un signal", () => {
  it("bornes incluses ; non mesuré → null", () => {
    expect(zoneSaison(SEUIL_SAISON_ALTS)).toBe("alts");
    expect(zoneSaison(74.9)).toBe("intermediaire");
    expect(zoneSaison(SEUIL_SAISON_BTC)).toBe("btc");
    expect(zoneSaison(0)).toBe("btc");
    expect(zoneSaison(null)).toBeNull();
    expect(zoneSaison(Number.NaN)).toBeNull();
  });
});
