import { describe, expect, it } from "vitest";
import { distanceAth, PICS_CYCLES, repliPostPic } from "./cycleAth";
import { decouperCycles, HALVINGS, statsCycle } from "./cycle";
import type { PointMetrique } from "./onchain/coinmetrics";

/** Un jour en millisecondes (les points Coin Metrics sont datés à 00:00 UTC). */
const JOUR = 86_400_000;
const T0 = Date.UTC(2025, 9, 6);

/** Série quotidienne à partir de `debut` : un point par prix, jour après jour. */
function quotidien(debut: number, prix: readonly number[]): PointMetrique[] {
  return prix.map((value, i) => ({ time: debut + i * JOUR, value }));
}

/*
 * Lectures réelles (PriceUSD Coin Metrics au 2026-09-13, non embarquables) : ATH 124 824,45 $
 * le 2025-10-06, J+342, repli −38,51 %, repli max −53,11 % le 2026-06-30. Au même J+342 depuis
 * les pics 2013 / 2017 / 2021 : −67,59 / −78,16 / −71,48 % ; repli max −71,56 / −78,16 / −72,60 %.
 */

describe("PICS_CYCLES", () => {
  it("fixe les pics passés aux maxima quotidiens PriceUSD vérifiés (00:00 UTC)", () => {
    expect(PICS_CYCLES).toEqual({
      1: Date.UTC(2013, 11, 4),
      2: Date.UTC(2017, 11, 16),
      3: Date.UTC(2021, 10, 8),
    });
  });

  it("place chaque pic strictement entre son halving et le suivant", () => {
    for (const k of [1, 2, 3] as const) {
      expect(PICS_CYCLES[k]).toBeGreaterThan(HALVINGS[k - 1]!);
      expect(PICS_CYCLES[k]).toBeLessThan(HALVINGS[k]!);
    }
  });

  it("coïncide avec le sommet des cycles clos (correctif A) sur un historique log-linéaire réaliste", () => {
    const ancres: [string, number][] = [
      ["2012-11-28", 12.35], ["2013-12-04", 1_134.93], ["2015-01-14", 175.64], ["2016-07-09", 650],
      ["2017-12-16", 19_640.51], ["2018-12-15", 3_185], ["2020-05-11", 8_600], ["2021-11-08", 67_541.76],
      ["2022-11-09", 15_758], ["2024-03-13", 73_081.58], ["2024-04-20", 64_000],
    ];
    const points: PointMetrique[] = [];
    for (let k = 0; k < ancres.length - 1; k += 1) {
      const t0 = Date.parse(`${ancres[k]![0]}T00:00:00Z`);
      const t1 = Date.parse(`${ancres[k + 1]![0]}T00:00:00Z`);
      const [p0, p1] = [ancres[k]![1], ancres[k + 1]![1]];
      const n = Math.round((t1 - t0) / JOUR);
      for (let i = 0; i < n; i += 1) {
        points.push({ time: t0 + i * JOUR, value: Math.exp(Math.log(p0) + ((Math.log(p1) - Math.log(p0)) * i) / n) });
      }
    }
    const clos = decouperCycles(points).filter((s) => s.clos);
    expect(clos.map((s) => s.halvingIndex)).toEqual([1, 2, 3]);
    for (const s of clos) {
      const { topJour } = statsCycle(s.points, true);
      expect(s.halvingMs + topJour * JOUR).toBe(PICS_CYCLES[s.halvingIndex as 1 | 2 | 3]);
    }
  });
});

describe("repliPostPic", () => {
  it("lit le prix au pic, à pic + N jours, et le plus bas sur [pic, pic + N]", () => {
    const pts = quotidien(T0, [100, 40, 60, 90]);
    expect(repliPostPic(pts, T0, 2)).toEqual({ prixPic: 100, repliPct: -40, repliMaxPct: -60 });
  });

  it("J+0 : repli nul", () => {
    expect(repliPostPic(quotidien(T0, [100, 40]), T0, 0)).toEqual({ prixPic: 100, repliPct: 0, repliMaxPct: 0 });
  });

  it("pic absent des données : null (jamais 0)", () => {
    expect(repliPostPic(quotidien(T0, [100, 40, 60]), T0 - JOUR, 1)).toBeNull();
  });

  it("pic + N au-delà des données : null", () => {
    expect(repliPostPic(quotidien(T0, [100, 40, 60]), T0, 5)).toBeNull();
  });

  it("prix non fini au pic ou à J+N : null ; un non-fini entre les deux est ignoré", () => {
    expect(repliPostPic(quotidien(T0, [NaN, 40, 60]), T0, 2)).toBeNull();
    expect(repliPostPic(quotidien(T0, [100, 40, NaN]), T0, 2)).toBeNull();
    const r = repliPostPic(quotidien(T0, [100, NaN, 70]), T0, 2);
    expect(r!.prixPic).toBe(100);
    expect(r!.repliPct).toBeCloseTo(-30, 10);
    expect(r!.repliMaxPct).toBeCloseTo(-30, 10);
  });

  it("N négatif ou non entier : null", () => {
    const pts = quotidien(T0, [100, 40, 60]);
    expect(repliPostPic(pts, T0, -1)).toBeNull();
    expect(repliPostPic(pts, T0, 1.5)).toBeNull();
  });
});

describe("distanceAth", () => {
  it("ATH, jours depuis l'ATH, repli courant et repli max depuis l'ATH", () => {
    const r = distanceAth(quotidien(T0, [100, 200, 50, 120]));
    expect(r).not.toBeNull();
    expect(r!.athPrix).toBe(200);
    expect(r!.athMs).toBe(T0 + JOUR);
    expect(r!.dernierMs).toBe(T0 + 3 * JOUR);
    expect(r!.joursDepuisAth).toBe(2);
    expect(r!.repliCourantPct).toBeCloseTo(-40, 10);
    expect(r!.repliMaxPct).toBeCloseTo(-75, 10);
    expect(r!.repliMaxMs).toBe(T0 + 2 * JOUR);
  });

  it("égalité de maximum : la première occurrence est l'ATH", () => {
    const r = distanceAth(quotidien(T0, [100, 200, 150, 200, 180]));
    expect(r!.athMs).toBe(T0 + JOUR);
    expect(r!.joursDepuisAth).toBe(3);
    expect(r!.repliMaxMs).toBe(T0 + 2 * JOUR);
  });

  it("ATH au dernier point : 0 jour, repli courant et repli max nuls", () => {
    const r = distanceAth(quotidien(T0, [100, 150, 200]));
    expect(r!.joursDepuisAth).toBe(0);
    expect(r!.repliCourantPct).toBe(0);
    expect(r!.repliMaxPct).toBe(0);
    expect(r!.repliMaxMs).toBe(T0 + 2 * JOUR);
  });

  it("ignore les prix non finis ou ≤ 0 et trie une entrée désordonnée", () => {
    const pts = quotidien(T0, [100, 200, 50, 120]);
    const bruit: PointMetrique[] = [{ time: T0 + 4 * JOUR, value: NaN }, { time: T0 + 5 * JOUR, value: 0 }];
    const r = distanceAth([pts[3]!, ...bruit, pts[0]!, pts[2]!, pts[1]!]);
    expect(r!.athPrix).toBe(200);
    expect(r!.dernierMs).toBe(T0 + 3 * JOUR);
    expect(r!.joursDepuisAth).toBe(2);
  });

  it("aucune série exploitable : null", () => {
    expect(distanceAth([])).toBeNull();
    expect(distanceAth([{ time: T0, value: NaN }, { time: T0 + JOUR, value: -5 }])).toBeNull();
  });

  it("compare au même J+N depuis chaque pic passé ; null pour un pic hors données", () => {
    // Pic 2021 à 100, puis −1 par jour ; ATH courant 300 neuf jours avant le dernier point.
    const pic3 = PICS_CYCLES[3];
    const cycle2021 = quotidien(pic3, Array.from({ length: 30 }, (_, i) => 100 - i));
    const debutCourant = Date.UTC(2025, 9, 1);
    const courant = quotidien(debutCourant, [250, 280, 300, 290, 270, 260, 255, 250, 240, 230, 240, 255]);
    const r = distanceAth([...cycle2021, ...courant]);
    expect(r!.joursDepuisAth).toBe(9);
    expect(r!.cyclesPasses[3]!.prixPic).toBe(100);
    expect(r!.cyclesPasses[3]!.repliPct).toBeCloseTo(-9, 10);
    expect(r!.cyclesPasses[3]!.repliMaxPct).toBeCloseTo(-9, 10);
    expect(r!.cyclesPasses[1]).toBeNull();
    expect(r!.cyclesPasses[2]).toBeNull();
  });
});
