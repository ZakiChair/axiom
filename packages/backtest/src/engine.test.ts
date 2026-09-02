/**
 * @axiom/backtest — engine.test.ts
 *
 * Tests déterministes du moteur de backtest sur des séries synthétiques construites à la
 * main, avec les valeurs attendues CALCULÉES pas à pas (comme les tests d'indicateurs).
 *
 * Invariants vérifiés explicitement :
 *  - exécution à l'OPEN de la barre N+1 (pas de look-ahead) ;
 *  - un signal sur la DERNIÈRE barre n'est jamais exécuté ;
 *  - stop/objectif évalués sur la CLÔTURE (un pic/creux intrabar ne déclenche pas) ;
 *  - une seule position à la fois ; règles vides = aucun signal ;
 *  - short, mode « les-deux » (retournement), frais + slippage, et les statistiques.
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator, getIndicator } from "@axiom/indicators";
import {
  calculerStats,
  construireEquity,
  runBacktest,
  sharpeAnnualise,
} from "./engine";
import type {
  Condition,
  ParamsBacktest,
  StrategieDef,
  TradeResultat,
} from "./types";

// ─────────────────────────── Helpers de construction ───────────────────────────

const T = 60_000; // 1 minute par barre
const t = (i: number): number => i * T;

/** Bougie complète (OHLC + volume), marquée clôturée. */
function bougie(time: number, o: number, h: number, l: number, c: number, v = 1): Candle {
  return { time, open: o, high: h, low: l, close: c, volume: v, closed: true };
}

/** Bougie sans intrabar particulier (high/low = enveloppe open/close). */
function barre(time: number, open: number, close: number): Candle {
  return bougie(time, open, Math.max(open, close), Math.min(open, close), close);
}

/** Croisement close × niveau constant. */
function croiseClose(niveau: number, sens: "hausse" | "baisse"): Condition {
  return {
    type: "croisement",
    a: { type: "prix", champ: "close" },
    b: { type: "constante", valeur: niveau },
    sens,
  };
}

/** Comparaison close vs niveau constant. */
function compareClose(comparateur: ">" | ">=" | "<" | "<=", niveau: number): Condition {
  return {
    type: "comparaison",
    gauche: { type: "prix", champ: "close" },
    comparateur,
    droite: { type: "constante", valeur: niveau },
  };
}

/** Paramètres « sans friction » (frais et slippage nuls). */
const SANS_FRICTION: ParamsBacktest = { fraisPct: 0, slippagePct: 0, capitalInitial: 10_000 };

// ─────────────────────────── 1. Exécution à l'open de N+1 (no look-ahead) ───────────────────────────

describe("exécution à l'open de la barre suivante", () => {
  it("entre au PRIX D'OUVERTURE de la barre N+1, pas au close du signal", () => {
    // Croisement close × 100 à la hausse à la barre 2 (close 99 → 101).
    // Décision à la clôture de la barre 2 → fill à l'OPEN de la barre 3 (= 105),
    // surtout PAS au close de la barre 2 (= 101).
    const candles = [
      barre(t(0), 99, 99),
      barre(t(1), 99, 99),
      barre(t(2), 101, 101), // close 101 > 100, close[1]=99 <= 100 → cross up à i=2
      bougie(t(3), 105, 106, 104, 106), // fill entrée = open 105
      bougie(t(4), 106, 110, 106, 110), // dernier close 110 → sortie "fin-donnees"
    ];
    const strat: StrategieDef = {
      reglesEntree: [croiseClose(100, "hausse")],
      reglesSortie: [],
      direction: "long",
      tailleFixe: 1000,
    };
    const r = runBacktest(candles, strat, SANS_FRICTION);
    expect(r.trades).toHaveLength(1);
    const trade = r.trades[0]!;
    expect(trade.sens).toBe("long");
    expect(trade.prixEntree).toBe(105); // open de la barre 3, pas 101
    expect(trade.tempsEntree).toBe(t(3));
    expect(trade.raison).toBe("fin-donnees");
    expect(trade.prixSortie).toBe(110); // dernier close
    // PnL : qté = 1000/105 ; brut = qté·(110-105) = 5000/105 ≈ 47.6190.
    expect(trade.pnl).toBeCloseTo(5000 / 105, 6);
    expect(trade.pnlPct).toBeCloseTo((5000 / 105 / 1000) * 100, 6);
  });

  it("N'EXÉCUTE PAS un signal survenu sur la dernière barre", () => {
    // Le croisement a lieu à la barre 3 (= dernière). Faute d'open suivant, aucun fill.
    const candles = [
      barre(t(0), 99, 99),
      barre(t(1), 99, 99),
      barre(t(2), 99, 99),
      barre(t(3), 101, 101), // cross up à i=3 = n-1 → JAMAIS exécuté
    ];
    const strat: StrategieDef = {
      reglesEntree: [croiseClose(100, "hausse")],
      reglesSortie: [],
      direction: "long",
      tailleFixe: 1000,
    };
    const r = runBacktest(candles, strat, SANS_FRICTION);
    expect(r.trades).toHaveLength(0);
  });
});

// ─────────────────────────── 2. Cycle complet long avec frais + slippage ───────────────────────────

describe("cycle long complet avec frais et slippage", () => {
  it("calcule le PnL net exact (fills glissés, frais des deux côtés)", () => {
    // Entrée : cross close×100 hausse à i=1 → fill open barre 2 (= 100).
    // Sortie : cross close×110 baisse à i=4 → fill open barre 5 (= 107).
    const candles = [
      barre(t(0), 99, 99),
      barre(t(1), 101, 101), // cross up à i=1 (close[0]=99<=100, close[1]=101>100)
      barre(t(2), 100, 115), // fill entrée = open 100
      barre(t(3), 115, 112),
      barre(t(4), 112, 108), // cross down ×110 à i=4 (close[3]=112>=110, close[4]=108<110)
      barre(t(5), 107, 107), // fill sortie = open 107
      barre(t(6), 107, 107),
    ];
    const strat: StrategieDef = {
      reglesEntree: [croiseClose(100, "hausse")],
      reglesSortie: [croiseClose(110, "baisse")],
      direction: "long",
      tailleFixe: 1000,
    };
    const params: ParamsBacktest = { fraisPct: 0.1, slippagePct: 0.05, capitalInitial: 10_000 };
    const r = runBacktest(candles, strat, params);
    expect(r.trades).toHaveLength(1);
    const trade = r.trades[0]!;

    // Calcul indépendant, pas à pas.
    const prixEntree = 100 * (1 + 0.0005); // long paie plus cher : 100.05
    const prixSortie = 107 * (1 - 0.0005); // clôture long vend moins cher : 106.9465
    const qty = 1000 / prixEntree;
    const brut = qty * (prixSortie - prixEntree);
    const notionnelSortie = qty * prixSortie;
    const frais = (1000 + notionnelSortie) * 0.001; // 0.1 % sur chaque côté
    const pnl = brut - frais;

    expect(trade.prixEntree).toBeCloseTo(prixEntree, 8);
    expect(trade.prixSortie).toBeCloseTo(prixSortie, 8);
    expect(trade.raison).toBe("regle");
    expect(trade.dureeBarres).toBe(3); // index 5 - index 2
    expect(trade.dureeMs).toBe(t(5) - t(2));
    expect(trade.frais).toBeCloseTo(frais, 8);
    expect(trade.pnl).toBeCloseTo(pnl, 8);
    expect(trade.pnlPct).toBeCloseTo((pnl / 1000) * 100, 8);
  });
});

// ─────────────────────────── 3. Stop sur clôture (sans intrabar) ───────────────────────────

describe("stop évalué sur la clôture, jamais intrabar", () => {
  it("ignore un LOW intrabar sous le stop tant que le close reste au-dessus", () => {
    // Entrée long à 100 (i=1 cross up → fill open barre 2 = 100). Stop 5 % → seuil 95.
    // Barre 3 : low = 90 (< 95) MAIS close = 98 (> 95) → PAS de stop (pas d'intrabar).
    // Barre 4 : close = 94 (<= 95) → stop, fill open barre 5 = 93.
    const candles = [
      barre(t(0), 99, 99),
      barre(t(1), 101, 101), // cross up à i=1
      barre(t(2), 100, 100), // fill entrée = 100 ; stop = 95
      bougie(t(3), 100, 101, 90, 98), // low 90 perce 95, close 98 > 95 → rien
      bougie(t(4), 97, 97, 94, 94), // close 94 <= 95 → STOP à i=4
      barre(t(5), 93, 93), // fill sortie = 93
      barre(t(6), 93, 93),
    ];
    const strat: StrategieDef = {
      reglesEntree: [croiseClose(100, "hausse")],
      reglesSortie: [],
      direction: "long",
      stopPct: 5,
      tailleFixe: 1000,
    };
    const r = runBacktest(candles, strat, SANS_FRICTION);
    expect(r.trades).toHaveLength(1);
    const trade = r.trades[0]!;
    expect(trade.raison).toBe("stop");
    expect(trade.prixEntree).toBe(100);
    expect(trade.prixSortie).toBe(93); // open barre 5, PAS le low 90 de la barre 3/4
    expect(trade.tempsSortie).toBe(t(5));
    expect(trade.dureeBarres).toBe(3);
    // qté = 10 ; pnl = 10·(93-100) = -70.
    expect(trade.pnl).toBeCloseTo(-70, 8);
  });
});

// ─────────────────────────── 4. Objectif sur clôture (sans intrabar) ───────────────────────────

describe("objectif évalué sur la clôture, jamais intrabar", () => {
  it("ignore un HIGH intrabar au-dessus de l'objectif tant que le close reste en-dessous", () => {
    // Entrée long à 100. Objectif 10 % → seuil 110.
    // Barre 3 : high = 115 (> 110) MAIS close = 105 (< 110) → PAS d'objectif.
    // Barre 4 : close = 111 (>= 110) → objectif, fill open barre 5 = 112.
    const candles = [
      barre(t(0), 99, 99),
      barre(t(1), 101, 101),
      barre(t(2), 100, 100), // entrée = 100 ; objectif = 110
      bougie(t(3), 100, 115, 100, 105), // high 115 dépasse 110, close 105 < 110 → rien
      bougie(t(4), 108, 112, 108, 111), // close 111 >= 110 → TARGET à i=4
      barre(t(5), 112, 112), // fill sortie = 112
      barre(t(6), 112, 112),
    ];
    const strat: StrategieDef = {
      reglesEntree: [croiseClose(100, "hausse")],
      reglesSortie: [],
      direction: "long",
      targetPct: 10,
      tailleFixe: 1000,
    };
    const r = runBacktest(candles, strat, SANS_FRICTION);
    expect(r.trades).toHaveLength(1);
    const trade = r.trades[0]!;
    expect(trade.raison).toBe("target");
    expect(trade.prixSortie).toBe(112);
    // qté = 10 ; pnl = 10·(112-100) = 120.
    expect(trade.pnl).toBeCloseTo(120, 8);
  });
});

// ─────────────────────────── 5. Direction short ───────────────────────────

describe("direction short", () => {
  it("profite d'une baisse de prix (pnl = qté·(entrée − sortie))", () => {
    // Entrée short : cross close×100 baisse à i=1 → fill open barre 2 = 100.
    // Sortie : cross close×90 baisse à i=4 → fill open barre 5 = 89.
    const candles = [
      barre(t(0), 101, 101),
      barre(t(1), 99, 99), // cross down ×100 à i=1 (101 >= 100, 99 < 100)
      barre(t(2), 100, 100), // fill entrée short = 100
      barre(t(3), 95, 95),
      barre(t(4), 92, 88), // cross down ×90 à i=4 (close[3]=95>=90, close[4]=88<90)
      barre(t(5), 89, 89), // fill sortie = 89
      barre(t(6), 89, 89),
    ];
    const strat: StrategieDef = {
      reglesEntree: [croiseClose(100, "baisse")],
      reglesSortie: [croiseClose(90, "baisse")],
      direction: "short",
      tailleFixe: 1000,
    };
    const r = runBacktest(candles, strat, SANS_FRICTION);
    expect(r.trades).toHaveLength(1);
    const trade = r.trades[0]!;
    expect(trade.sens).toBe("short");
    expect(trade.prixEntree).toBe(100);
    expect(trade.prixSortie).toBe(89);
    // qté = 10 ; pnl short = 10·(100-89) = 110.
    expect(trade.pnl).toBeCloseTo(110, 8);
  });
});

// ─────────────────────────── 6. Mode « les-deux » (retournement) ───────────────────────────

describe("mode les-deux (long via reglesEntree, short via reglesSortie)", () => {
  it("ouvre long puis short, chaque position fermée par le signal inverse", () => {
    // reglesEntree = close > 100 (signal long), reglesSortie = close < 100 (signal short).
    const candles = [
      barre(t(0), 105, 105), // i=0 flat : close>100 → OUVRE LONG, fill open barre 1 = 106
      barre(t(1), 106, 95), //  i=1 long : close<100 → FERME (regle), fill open barre 2 = 96
      barre(t(2), 96, 96), //   i=2 flat : close<100 → OUVRE SHORT, fill open barre 3 = 97
      barre(t(3), 97, 110), //  i=3 short : close>100 (signal long) → FERME, fill open barre 4 = 109
      barre(t(4), 109, 109), // barre de fill de la sortie short ; i=4 non traité (n-1)
    ];
    const strat: StrategieDef = {
      reglesEntree: [compareClose(">", 100)],
      reglesSortie: [compareClose("<", 100)],
      direction: "les-deux",
      tailleFixe: 1000,
    };
    const r = runBacktest(candles, strat, SANS_FRICTION);
    expect(r.trades).toHaveLength(2);
    const [t1, t2] = r.trades as [TradeResultat, TradeResultat];
    expect(t1.sens).toBe("long");
    expect(t1.prixEntree).toBe(106);
    expect(t1.prixSortie).toBe(96);
    expect(t1.raison).toBe("regle");
    expect(t2.sens).toBe("short");
    expect(t2.prixEntree).toBe(97);
    expect(t2.prixSortie).toBe(109);
    expect(t2.raison).toBe("regle");
  });
});

// ─────────────────────────── 7. Une position à la fois ───────────────────────────

describe("une seule position à la fois", () => {
  it("ignore les signaux d'entrée répétés tant qu'une position est ouverte", () => {
    // close > 100 sur toutes les barres : sans cette garde, on ouvrirait à chaque barre.
    const candles = [
      barre(t(0), 101, 101),
      barre(t(1), 102, 103),
      barre(t(2), 103, 104),
      barre(t(3), 104, 105),
      barre(t(4), 105, 106),
    ];
    const strat: StrategieDef = {
      reglesEntree: [compareClose(">", 100)],
      reglesSortie: [], // jamais de sortie par règle → 1 position tenue jusqu'au bout
      direction: "long",
      tailleFixe: 1000,
    };
    const r = runBacktest(candles, strat, SANS_FRICTION);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]!.raison).toBe("fin-donnees");
    expect(r.trades[0]!.prixEntree).toBe(102); // open barre 1
  });
});

// ─────────────────────────── 8. Règles vides = aucun signal ───────────────────────────

describe("règles vides", () => {
  it("reglesEntree vide n'ouvre jamais de position", () => {
    const candles = [barre(t(0), 90, 90), barre(t(1), 95, 95), barre(t(2), 99, 99)];
    const strat: StrategieDef = {
      reglesEntree: [],
      reglesSortie: [compareClose("<", 100)],
      direction: "long",
      tailleFixe: 1000,
    };
    const r = runBacktest(candles, strat, SANS_FRICTION);
    expect(r.trades).toHaveLength(0);
  });
});

// ─────────────────────────── 9. Opérande indicateur (RSI) + amorce ───────────────────────────

describe("opérande indicateur (croisé avec @axiom/indicators)", () => {
  it("déclenche l'entrée exactement à la 1re barre où RSI < 30, exécutée à l'open suivant", () => {
    // Série : montée douce puis forte baisse (RSI plonge) puis reprise (RSI remonte).
    const closes = [100, 101, 102, 101, 100, 98, 95, 90, 85, 80, 82, 88, 95, 102, 110];
    const candles = closes.map((c, i) => barre(t(i), c, c));

    // Oracle : on lit la série RSI(3) calculée par le package indicateurs.
    const def = getIndicator("rsi")!;
    const rsi = computeIndicator(def, candles, { length: 3 }).series.rsi!;
    // 1re barre (avec RSI défini) sous 30, et disposant d'une barre suivante pour le fill.
    let iDecl = -1;
    for (let i = 0; i < candles.length - 1; i++) {
      const v = rsi[i];
      if (v !== undefined && v < 30) {
        iDecl = i;
        break;
      }
    }
    expect(iDecl).toBeGreaterThan(0); // la série est bien conçue (RSI passe sous 30)

    const strat: StrategieDef = {
      reglesEntree: [
        {
          type: "comparaison",
          gauche: { type: "indicateur", indicateurId: "rsi", params: { length: 3 }, output: "rsi" },
          comparateur: "<",
          droite: { type: "constante", valeur: 30 },
        },
      ],
      reglesSortie: [
        {
          type: "comparaison",
          gauche: { type: "indicateur", indicateurId: "rsi", params: { length: 3 }, output: "rsi" },
          comparateur: ">",
          droite: { type: "constante", valeur: 70 },
        },
      ],
      direction: "long",
      tailleFixe: 1000,
    };
    const r = runBacktest(candles, strat, SANS_FRICTION);
    expect(r.trades.length).toBeGreaterThanOrEqual(1);
    const trade = r.trades[0]!;
    expect(trade.tempsEntree).toBe(candles[iDecl + 1]!.time); // fill à l'open de iDecl+1
    expect(trade.prixEntree).toBe(candles[iDecl + 1]!.open);
  });
});

// ─────────────────────────── 10. Statistiques (fonctions pures) ───────────────────────────

describe("statistiques agrégées", () => {
  it("calcule win rate, profit factor, drawdown, PnL et exposition", () => {
    // 3 trades fabriqués : +100 (+10 %), -50 (-5 %), +30 (+3 %). Capital = 1000.
    const mk = (
      pnl: number,
      pnlPct: number,
      tEntree: number,
      tSortie: number,
    ): TradeResultat => ({
      sens: "long",
      tempsEntree: tEntree,
      prixEntree: 100,
      tempsSortie: tSortie,
      prixSortie: 100,
      raison: "regle",
      quantite: 10,
      pnl,
      pnlPct,
      frais: 0,
      dureeBarres: 1,
      dureeMs: tSortie - tEntree,
      risqueInitial: null,
      r: null,
    });
    const trades = [mk(100, 10, 0, 1000), mk(-50, -5, 1000, 2000), mk(30, 3, 2000, 3000)];
    const candles = [barre(0, 100, 100), barre(3000, 100, 100)];
    const equity = construireEquity(trades, candles, 1000);
    const stats = calculerStats(trades, equity, candles, 1000);

    // Equity : 1000 → 1100 → 1050 → 1080. Pic = 1100.
    expect(equity).toHaveLength(4);
    expect(equity[0]!.equity).toBe(1000);
    expect(equity[3]!.equity).toBe(1080);
    // Drawdown max = (1100-1050)/1100·100 = 4.5454…
    expect(stats.maxDrawdownPct).toBeCloseTo((50 / 1100) * 100, 8);

    expect(stats.nbTrades).toBe(3);
    expect(stats.nbGagnants).toBe(2);
    expect(stats.nbPerdants).toBe(1);
    expect(stats.winRatePct).toBeCloseTo((2 / 3) * 100, 8);
    expect(stats.profitFactor).toBeCloseTo(130 / 50, 8); // 2.6
    expect(stats.pnlTotal).toBeCloseTo(80, 8);
    expect(stats.pnlTotalPct).toBeCloseTo(8, 8);
    expect(stats.gainMoyenPct).toBeCloseTo(6.5, 8); // (10+3)/2
    expect(stats.perteMoyennePct).toBeCloseTo(-5, 8);
    // Exposition : 3·1000 ms en position / 3000 ms de série = 100 %.
    expect(stats.expositionPct).toBeCloseTo(100, 8);
    expect(Number.isFinite(stats.sharpe)).toBe(true);
    expect(stats.sharpe).toBeGreaterThan(0); // moyenne des rendements > 0
  });

  it("profit factor = Infinity si aucune perte, 0 si aucun trade gagnant", () => {
    const gagnant: TradeResultat = {
      sens: "long", tempsEntree: 0, prixEntree: 100, tempsSortie: 1000, prixSortie: 110,
      raison: "regle", quantite: 10, pnl: 100, pnlPct: 10, frais: 0, dureeBarres: 1, dureeMs: 1000,
      risqueInitial: null, r: null,
    };
    const candles = [barre(0, 100, 100), barre(1000, 100, 100)];
    const s1 = calculerStats([gagnant], construireEquity([gagnant], candles, 1000), candles, 1000);
    expect(s1.profitFactor).toBe(Infinity);

    const s0 = calculerStats([], [], candles, 1000);
    expect(s0.profitFactor).toBe(0);
    expect(s0.nbTrades).toBe(0);
    expect(s0.winRatePct).toBe(0);
  });
});

// ─────────────────────────── 11. Sharpe annualisé (fonction pure isolée) ───────────────────────────

describe("sharpeAnnualise", () => {
  it("Sharpe brut · √tradesParAn sur des rendements connus", () => {
    // rendements = [0.10, -0.05, 0.03]. moyenne = 0.08/3 = 0.0266667.
    // écart-type d'échantillon (n-1) = √(0.01126667/2) = 0.0750555.
    // brut = 0.0266667 / 0.0750555 = 0.355293. Annualisé ×√252 = 0.355293·15.8745 ≈ 5.6404.
    const s = sharpeAnnualise([0.1, -0.05, 0.03], 252);
    expect(s).toBeCloseTo(5.6404, 2);
  });

  it("renvoie 0 pour moins de 2 trades ou une variance nulle", () => {
    expect(sharpeAnnualise([], 252)).toBe(0);
    expect(sharpeAnnualise([0.05], 252)).toBe(0);
    expect(sharpeAnnualise([0.02, 0.02, 0.02], 252)).toBe(0); // écart-type nul
  });
});

// ─────────────────────────── 12. Stop ATR + sizing en % de risque ───────────────────────────

describe("stop ATR figé à l'entrée", () => {
  it("fixe le niveau à prixEntree − 2·ATR[i] (long) et stoppe à la clôture sous ce niveau", () => {
    // Entrée long : cross close×100 hausse à i=1 → fill open barre 2 = 100.
    // ATR(2) à i=1 est défini (amorce Wilder). On impose un ATR via des ranges connus
    // puis un close sous le niveau figé.
    const candles = [
      bougie(t(0), 99, 101, 97, 99, 1),
      bougie(t(1), 101, 103, 99, 101, 1), // cross up ; ATR défini
      bougie(t(2), 100, 102, 98, 100, 1), // fill entrée = 100
      bougie(t(3), 100, 101, 50, 50, 1), // close 50 → stop (niveau figé ~100−2·ATR)
      barre(t(4), 50, 50), // fill sortie = 50
      barre(t(5), 50, 50),
    ];
    const strat: StrategieDef = {
      reglesEntree: [croiseClose(100, "hausse")],
      reglesSortie: [],
      direction: "long",
      stopAtr: { length: 2, mult: 2 },
      tailleFixe: 1000,
    };
    const r = runBacktest(candles, strat, SANS_FRICTION);
    expect(r.trades.length).toBe(1);
    const trade = r.trades[0]!;
    expect(trade.raison).toBe("stop");
    expect(trade.prixEntree).toBe(100);
    expect(trade.risqueInitial).not.toBeNull();
    expect(trade.r).not.toBeNull();
    expect(trade.r!).toBeLessThan(0);
  });

  it("ATR indéfini à la barre de décision → pas d'entrée", () => {
    // ATR length 50 sur 6 barres : amorce trop courte.
    const candles = [
      barre(t(0), 99, 99),
      barre(t(1), 101, 101),
      barre(t(2), 100, 100),
      barre(t(3), 100, 100),
      barre(t(4), 100, 100),
      barre(t(5), 100, 100),
    ];
    const strat: StrategieDef = {
      reglesEntree: [croiseClose(100, "hausse")],
      reglesSortie: [],
      direction: "long",
      stopAtr: { length: 50, mult: 2 },
      tailleFixe: 1000,
    };
    expect(runBacktest(candles, strat, SANS_FRICTION).trades).toHaveLength(0);
  });

  it("stopPct + stopAtr → atr retenu (entrée stoppée au niveau ATR, pas au 5 %)", () => {
    const candles = [
      bougie(t(0), 99, 101, 97, 99, 1),
      bougie(t(1), 101, 103, 99, 101, 1),
      bougie(t(2), 100, 102, 98, 100, 1),
      bougie(t(3), 100, 101, 94, 94, 1), // close 94 : 5 % = 95 → stop pct, ATR×2 souvent plus large
      barre(t(4), 94, 94),
      barre(t(5), 94, 94),
    ];
    const atr: StrategieDef = {
      reglesEntree: [croiseClose(100, "hausse")],
      reglesSortie: [],
      direction: "long",
      stopPct: 5,
      stopAtr: { length: 2, mult: 10 }, // ATR×10 très large → close 94 ne touche PAS
      tailleFixe: 1000,
    };
    const r = runBacktest(candles, atr, SANS_FRICTION);
    // Si ATR est retenu, le close 94 ne stoppe pas (niveau trop loin) → fin-donnees.
    expect(r.trades[0]?.raison).toBe("fin-donnees");
  });
});

describe("sizing en % de risque", () => {
  it("quantite = (capital × risque%) / distance exacte ; r = pnl net / risque", () => {
    // Entrée long 100, stop 5 % → niveau 95, distance 5.
    // capital 10 000, risque 1 % → 100 USD de risque → qté = 100/5 = 20.
    const candles = [
      barre(t(0), 99, 99),
      barre(t(1), 101, 101),
      barre(t(2), 100, 100),
      barre(t(3), 94, 94), // close 94 ≤ 95 → stop
      barre(t(4), 93, 93), // fill 93
      barre(t(5), 93, 93),
    ];
    const strat: StrategieDef = {
      reglesEntree: [croiseClose(100, "hausse")],
      reglesSortie: [],
      direction: "long",
      stopPct: 5,
      risquePct: 1,
      tailleFixe: 1000, // ignoré
    };
    const r = runBacktest(candles, strat, { ...SANS_FRICTION, capitalInitial: 10_000 });
    const trade = r.trades[0]!;
    expect(trade.quantite).toBeCloseTo(20, 8);
    expect(trade.risqueInitial).toBeCloseTo(100, 8);
    expect(trade.pnl).toBeCloseTo(20 * (93 - 100), 8); // −140
    expect(trade.r).toBeCloseTo(-140 / 100, 8);
  });

  it("risquePct sans stop → tailleFixe (ignoré)", () => {
    const candles = [
      barre(t(0), 99, 99),
      barre(t(1), 101, 101),
      barre(t(2), 100, 100),
      barre(t(3), 110, 110),
    ];
    const strat: StrategieDef = {
      reglesEntree: [croiseClose(100, "hausse")],
      reglesSortie: [],
      direction: "long",
      risquePct: 1,
      tailleFixe: 1000,
    };
    const r = runBacktest(candles, strat, SANS_FRICTION);
    expect(r.trades[0]!.quantite).toBeCloseTo(10, 8); // 1000/100
    expect(r.trades[0]!.r).toBeNull();
    expect(r.stats.expectancyR).toBeNull();
  });

  it("R d'un stop exact inclut les frais (pas −1 pile)", () => {
    const candles = [
      barre(t(0), 99, 99),
      barre(t(1), 101, 101),
      barre(t(2), 100, 100),
      barre(t(3), 95, 95), // close = stop 95
      barre(t(4), 95, 95), // fill 95
      barre(t(5), 95, 95),
    ];
    const strat: StrategieDef = {
      reglesEntree: [croiseClose(100, "hausse")],
      reglesSortie: [],
      direction: "long",
      stopPct: 5,
      risquePct: 1,
      tailleFixe: 1000,
    };
    const r = runBacktest(candles, strat, { fraisPct: 0.05, slippagePct: 0, capitalInitial: 10_000 });
    const trade = r.trades[0]!;
    expect(trade.r).not.toBeNull();
    expect(trade.r!).toBeLessThan(-1); // frais dans le R
    expect(trade.frais).toBeGreaterThan(0);
  });
});
