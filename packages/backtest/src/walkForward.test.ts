/**
 * @axiom/backtest — walkForward.test.ts
 *
 * Partage d'un résultat de backtest en deux moitiés TEMPORELLES, avec les valeurs
 * attendues CALCULÉES à la main sur un résultat construit point par point (convention
 * de engine.test.ts). Ce qui est verrouillé :
 *  - la frontière est le MILIEU des bougies (index `floor(nbBougies / 2)`), pas la
 *    médiane des trades — même règle que `partagerMoities` (statsRejeu) ;
 *  - un trade est rangé par sa date d'ENTRÉE : il peut chevaucher la frontière ;
 *  - le drawdown de chaque moitié repart d'un pic réinitialisé au capital de début
 *    de moitié (le pic de la 1re moitié ne « contamine » pas la 2e) ;
 *  - le % de PnL est rapporté à l'équité au DÉBUT de la moitié, pas au capital initial.
 */
import { describe, expect, it } from "vitest";
import { partagerResultatMoities } from "./walkForward";
import type { PointEquity, ResultatBacktest, StatsBacktest, TradeResultat } from "./types";

const T = 60_000; // 1 minute par barre
const t = (i: number): number => i * T;

function trade(entree: number, sortie: number, pnl: number, r: number | null): TradeResultat {
  return {
    sens: "long",
    tempsEntree: t(entree),
    prixEntree: 100,
    tempsSortie: t(sortie),
    prixSortie: 100 + pnl,
    raison: "regle",
    quantite: 1,
    pnl,
    pnlPct: pnl,
    frais: 0,
    dureeBarres: sortie - entree,
    dureeMs: t(sortie) - t(entree),
    risqueInitial: r === null ? null : 10,
    r,
    maePct: 0,
    mfePct: 0,
  };
}

/** Point d'équité : le drawdown porté par le point est IGNORÉ (recalculé par moitié). */
function point(i: number, equity: number): PointEquity {
  return { temps: t(i), equity, drawdownPct: 99 };
}

const STATS_NULLES: StatsBacktest = {
  nbTrades: 0, nbGagnants: 0, nbPerdants: 0, winRatePct: 0, profitFactor: 0, pnlTotal: 0,
  pnlTotalPct: 0, maxDrawdownPct: 0, sharpe: 0, expositionPct: 0, gainMoyenPct: 0,
  perteMoyennePct: 0, nbTradesR: 0, sommeR: 0, expectancyR: null, maeMoyenPct: 0, mfeMoyenPct: 0,
};

/**
 * 10 bougies (t0..t9), équité = point initial + un point par bougie (contrat de
 * `construireEquity`). Frontière attendue : bougie 5 → t(5).
 *  - A entre en t1, sort en t3, +10 (R = 1)        → 1re moitié
 *  - B entre en t4, sort en t6, −4 (R = −0,5)      → 1re moitié (CHEVAUCHE la frontière)
 *  - C entre en t6, sort en t8, +6 (sans stop)     → 2e moitié
 *  - D entre en t8, sort en t9, −2 (R = −0,25)     → 2e moitié
 */
function resultatFixture(): ResultatBacktest {
  return {
    trades: [trade(1, 3, 10, 1), trade(4, 6, -4, -0.5), trade(6, 8, 6, null), trade(8, 9, -2, -0.25)],
    equity: [
      point(0, 100), // point initial (même temps que la bougie 0)
      point(0, 100), point(1, 104), point(2, 108), point(3, 107), point(4, 110),
      point(5, 106), point(6, 104), point(7, 108), point(8, 112), point(9, 110),
    ],
    stats: STATS_NULLES,
    nbBougies: 10,
  };
}

describe("partagerResultatMoities", () => {
  it("coupe au milieu des bougies et range chaque trade selon sa date d'entrée", () => {
    const partage = partagerResultatMoities(resultatFixture())!;
    expect(partage.frontiere).toBe(t(5));
    expect(partage.m1.debut).toBe(t(0));
    expect(partage.m1.fin).toBe(t(5));
    expect(partage.m2.debut).toBe(t(5));
    expect(partage.m2.fin).toBe(t(9));
    // B (entrée t4, sortie t6) compte dans la 1re moitié malgré sa sortie après la frontière.
    expect(partage.m1.nbTrades).toBe(2);
    expect(partage.m2.nbTrades).toBe(2);
  });

  it("calcule PnL, taux de réussite, facteur de profit et expectancy R par moitié", () => {
    const { m1, m2 } = partagerResultatMoities(resultatFixture())!;
    // 1re moitié : +10 − 4 = +6 sur un capital de début de 100.
    expect(m1.pnlTotal).toBe(6);
    expect(m1.pnlTotalPct).toBeCloseTo(6, 9);
    expect(m1.winRatePct).toBe(50);
    expect(m1.profitFactor).toBeCloseTo(2.5, 9);
    expect(m1.nbTradesR).toBe(2);
    expect(m1.expectancyR).toBeCloseTo(0.25, 9);
    // 2e moitié : +6 − 2 = +4 sur l'équité de fin de 1re moitié (110, point t4).
    expect(m2.pnlTotal).toBe(4);
    expect(m2.pnlTotalPct).toBeCloseTo((4 / 110) * 100, 9);
    expect(m2.winRatePct).toBe(50);
    expect(m2.profitFactor).toBeCloseTo(3, 9);
    expect(m2.nbTradesR).toBe(1);
    expect(m2.expectancyR).toBeCloseTo(-0.25, 9);
  });

  it("recalcule le drawdown de chaque moitié depuis un pic réinitialisé", () => {
    const { m1, m2 } = partagerResultatMoities(resultatFixture())!;
    // 1re moitié : 100, 100, 104, 108, 107, 110 → creux 107 sous le pic 108.
    expect(m1.maxDrawdownPct).toBeCloseTo((1 / 108) * 100, 9);
    // 2e moitié : pic de départ = 110 (équité de fin de 1re moitié), puis 106, 104, 108, 112, 110
    // → creux 104 sous 110 = 5,4545 %. Le drawdown global (porté par les points) est ignoré.
    expect(m2.maxDrawdownPct).toBeCloseTo((6 / 110) * 100, 9);
  });

  it("une moitié sans trade a des agrégats nuls et un facteur de profit à 0", () => {
    const resultat = resultatFixture();
    resultat.trades = [trade(1, 3, 10, 1)];
    const { m1, m2 } = partagerResultatMoities(resultat)!;
    expect(m1.nbTrades).toBe(1);
    expect(m1.profitFactor).toBe(Infinity); // aucune perte
    expect(m2).toMatchObject({ nbTrades: 0, pnlTotal: 0, pnlTotalPct: 0, winRatePct: 0, profitFactor: 0, nbTradesR: 0, expectancyR: null });
  });

  it("refuse un résultat trop court pour définir deux moitiés", () => {
    const resultat = resultatFixture();
    resultat.nbBougies = 1;
    resultat.equity = [point(0, 100), point(0, 100)];
    expect(partagerResultatMoities(resultat)).toBeNull();
    expect(partagerResultatMoities({ ...resultatFixture(), equity: [], nbBougies: 0 })).toBeNull();
  });
});
