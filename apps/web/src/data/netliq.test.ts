import { describe, expect, it } from "vitest";
import type { MacroSeries } from "./macro/types";
import { normaliserSerie, serieNetliq, statsNetliq } from "./netliq";
import type { PointFred } from "./netliq";

describe("normaliserSerie — normalisation d'unités FRED vers Md$", () => {
  it("convertit les millions de dollars en milliards (WALCL/WTREGEN, facteur 1e-3)", () => {
    // Points bruts en Millions of U.S. Dollars (unité FRED de WALCL/WTREGEN).
    // time = 2026-06-24T00:00:00Z ; 918 696 M$ → 918,696 Md$.
    const brute: MacroSeries = [
      { time: Date.parse("2026-06-24T00:00:00Z"), value: 918696 },
      { time: Date.parse("2026-07-15T00:00:00Z"), value: 6735609 },
    ];
    expect(normaliserSerie(brute, 1e-3)).toEqual([
      { date: "2026-06-24", valeur: 918.696 },
      { date: "2026-07-15", valeur: 6735.609 },
    ]);
  });

  it("laisse inchangées les valeurs déjà en milliards (RRPONTSYD, facteur 1)", () => {
    const brute: MacroSeries = [{ time: Date.parse("2026-06-02T00:00:00Z"), value: 2.502 }];
    expect(normaliserSerie(brute, 1)).toEqual([{ date: "2026-06-02", valeur: 2.502 }]);
  });

  it("préserve l'ordre et renvoie une série vide pour une entrée vide", () => {
    expect(normaliserSerie([], 1e-3)).toEqual([]);
  });
});

/** Raccourci de fabrication de PointFred pour les fixtures. */
function pf(date: string, valeur: number): PointFred {
  return { date, valeur };
}

describe("serieNetliq — netliq = walcl − tga − rrp, axe = union des 3 jambes, LOCF", () => {
  it("étale les jambes HEBDO (WALCL et TGA) sur l'axe quotidien du RRP (LOCF niveau)", () => {
    // WALCL hebdo (mercredis), TGA hebdo (mercredis), RRP quotidien.
    // Les deux jambes hebdo sont forward-fillées (dernière valeur connue) sur
    // chaque date quotidienne apportée par le RRP.
    const walcl = [pf("2026-01-07", 6000), pf("2026-01-14", 6100)];
    const tga = [pf("2026-01-07", 900), pf("2026-01-14", 950)];
    const rrp = [
      pf("2026-01-07", 100),
      pf("2026-01-08", 101),
      pf("2026-01-09", 102),
      pf("2026-01-14", 108),
    ];
    // Union des dates = {07,08,09,14}. Chaque jambe hebdo garde sa valeur jusqu'au
    // prochain point connu :
    //   07 : 6000 − 900 − 100 = 5000
    //   08 : 6000 − 900 − 101 = 4999   (WALCL/TGA LOCF depuis le 07)
    //   09 : 6000 − 900 − 102 = 4998   (WALCL/TGA LOCF depuis le 07)
    //   14 : 6100 − 950 − 108 = 5042
    expect(serieNetliq(walcl, tga, rrp)).toEqual([
      { date: "2026-01-07", netliq: 5000 },
      { date: "2026-01-08", netliq: 4999 },
      { date: "2026-01-09", netliq: 4998 },
      { date: "2026-01-14", netliq: 5042 },
    ]);
  });

  it("n'émet aucun point tant que les 3 jambes ne sont pas amorcées", () => {
    // walcl amorce le 05, rrp le 06, tga seulement le 07 → premier point = 07
    // (max des premières dates), les dates 05 et 06 sont ignorées.
    const walcl = [pf("2026-01-05", 6000), pf("2026-01-08", 6010)];
    const rrp = [pf("2026-01-06", 100), pf("2026-01-07", 101), pf("2026-01-08", 102)];
    const tga = [pf("2026-01-07", 900)];
    expect(serieNetliq(walcl, tga, rrp)).toEqual([
      // 07 : 6000 (LOCF 05) − 900 − 101 = 4999
      { date: "2026-01-07", netliq: 4999 },
      // 08 : 6010 − 900 (LOCF 07) − 102 = 5008
      { date: "2026-01-08", netliq: 5008 },
    ]);
  });

  it("tolère des dates d'entrée en désordre (tri interne par jambe et à la sortie)", () => {
    const walcl = [pf("2026-01-14", 6100), pf("2026-01-07", 6000)];
    const tga = [pf("2026-01-14", 950), pf("2026-01-07", 900)];
    const rrp = [pf("2026-01-08", 101), pf("2026-01-14", 108), pf("2026-01-07", 100)];
    expect(serieNetliq(walcl, tga, rrp)).toEqual([
      { date: "2026-01-07", netliq: 5000 },
      { date: "2026-01-08", netliq: 4999 },
      { date: "2026-01-14", netliq: 5042 },
    ]);
  });

  it("renvoie une série vide si une jambe est vide (jamais amorcée)", () => {
    expect(serieNetliq([pf("2026-01-07", 6000)], [], [pf("2026-01-07", 100)])).toEqual([]);
  });
});

describe("statsNetliq — courant / delta4s / min2a / max2a", () => {
  it("série vide → toutes les stats null", () => {
    expect(statsNetliq([])).toEqual({ courant: null, delta4s: null, min2a: null, max2a: null });
  });

  it("courant = dernier point, min/max sur toute la série", () => {
    const serie = [
      { date: "2026-01-01", netliq: 5000 },
      { date: "2026-01-15", netliq: 5100 },
      { date: "2026-02-01", netliq: 4900 },
    ];
    const s = statsNetliq(serie);
    expect(s.courant).toBe(4900);
    expect(s.min2a).toBe(4900);
    expect(s.max2a).toBe(5100);
  });

  it("delta4s = courant − dernier point ≥ 28 jours avant le dernier t", () => {
    // dernier t = 2026-02-01 ; seuil = 2026-01-04 (28 j avant).
    //   2026-01-15 (17 j) → trop récent, écarté
    //   2026-01-01 (31 j) → retenu, c'est le plus récent ≥ 28 j
    const serie = [
      { date: "2026-01-01", netliq: 5000 },
      { date: "2026-01-15", netliq: 5010 },
      { date: "2026-02-01", netliq: 5050 },
    ];
    expect(statsNetliq(serie).delta4s).toBe(50); // 5050 − 5000
  });

  it("delta4s : la borne exacte de 28 jours est incluse (≥)", () => {
    // 2026-02-01 − 28 j = 2026-01-04, présent → inclus.
    const serie = [
      { date: "2026-01-04", netliq: 5000 },
      { date: "2026-02-01", netliq: 5040 },
    ];
    expect(statsNetliq(serie).delta4s).toBe(40);
  });

  it("delta4s = null si aucun point n'est assez ancien (historique trop court)", () => {
    const serie = [
      { date: "2026-01-20", netliq: 5000 },
      { date: "2026-02-01", netliq: 5040 }, // 12 j d'écart seulement
    ];
    const s = statsNetliq(serie);
    expect(s.delta4s).toBeNull();
    expect(s.courant).toBe(5040); // courant reste défini
  });
});
