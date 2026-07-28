/**
 * @axiom/backtest — statsRejeu.test.ts
 *
 * Dérivation À LA MAIN de référence, sur trois trades de PnL +10 %, −5 %, +2 % :
 *
 *   winRate       = 2 gagnants / 3 = 66.666… → 66.67 %
 *   expectancy    = (10 − 5 + 2) / 3 = 7 / 3 = 2.3333 %
 *   equity        = 1 → 1.10 → 1.10 × 0.95 = 1.045 → 1.045 × 1.02 = 1.0659
 *   pnlCompose    = 1.0659 − 1 = +6.59 %  (≠ somme arithmétique +7 %)
 *   maxDrawdown   = pic 1.10 → creux 1.045 : (1.045 − 1.10) / 1.10 = −0.05 → −5.0 %
 *   dureeMoyenne  = (3 + 2 + 4) / 3 = 3 bougies (indices ci-dessous)
 *
 * Les valeurs composées et le drawdown sont les deux seules qui distinguent ce
 * module d'une simple moyenne : elles sont donc pinnées au centième.
 */
import { describe, expect, it } from "vitest";
import type { TradeStrategie } from "@axiom/indicators";
import { partagerMoities, statsTrades } from "./statsRejeu";

/** Trade clos synthétique : seuls sens/index/pnlPct comptent pour les stats. */
function trade(idxEntree: number, idxSortie: number, pnlPct: number): TradeStrategie {
  return { sens: 1, idxEntree, prixEntree: 100, idxSortie, prixSortie: 100 + pnlPct, pnlPct };
}

const TROIS_TRADES: TradeStrategie[] = [
  trade(2, 5, 10), // durée 3
  trade(8, 10, -5), // durée 2
  trade(12, 16, 2), // durée 4
];

describe("statsTrades", () => {
  it("reproduit la dérivation à la main sur [+10 %, −5 %, +2 %]", () => {
    const s = statsTrades(TROIS_TRADES);
    expect(s.nbTrades).toBe(3);
    expect(s.winRate).toBeCloseTo(66.67, 2);
    expect(s.expectancy).toBeCloseTo(2.33, 2);
    expect(s.pnlComposePct).toBeCloseTo(6.59, 2);
    expect(s.maxDrawdownPct).toBeCloseTo(-5.0, 2);
    expect(s.dureeMoyenne).toBeCloseTo(3, 10);
  });

  it("compose au lieu d'additionner (garde anti-tautologie : 6.59 ≠ 7)", () => {
    const somme = TROIS_TRADES.reduce((acc, t) => acc + (t.pnlPct ?? 0), 0);
    expect(somme).toBeCloseTo(7, 10);
    expect(statsTrades(TROIS_TRADES).pnlComposePct).not.toBeCloseTo(somme, 2);
  });

  it("compte un trade nul comme gagnant (hors frais, il ne coûte rien)", () => {
    const s = statsTrades([trade(1, 2, 0), trade(3, 4, -1)]);
    expect(s.winRate).toBeCloseTo(50, 10);
  });

  it("drawdown nul quand l'equity ne recule jamais", () => {
    const s = statsTrades([trade(1, 2, 3), trade(3, 4, 4)]);
    expect(s.maxDrawdownPct).toBe(0);
    // 1.03 × 1.04 − 1 = 7.12 %
    expect(s.pnlComposePct).toBeCloseTo(7.12, 2);
  });

  it("liste vide → zéros, jamais de NaN (cellule sans trade = résultat normal)", () => {
    const s = statsTrades([]);
    expect(s).toEqual({
      nbTrades: 0,
      winRate: 0,
      expectancy: 0,
      pnlComposePct: 0,
      maxDrawdownPct: 0,
      dureeMoyenne: 0,
    });
  });

  it("ignore le trade encore ouvert (pas de marquage au marché)", () => {
    const ouvert: TradeStrategie = { sens: 1, idxEntree: 20, prixEntree: 100 };
    const s = statsTrades([...TROIS_TRADES, ouvert]);
    expect(s.nbTrades).toBe(3);
    expect(s.expectancy).toBeCloseTo(2.33, 2);
  });
});

describe("partagerMoities", () => {
  it("coupe au milieu des BOUGIES, pas au milieu des trades", () => {
    // 20 bougies → frontière à l'index 10 : 2 trades entrent avant, 1 après —
    // une coupe « médiane des trades » aurait donné 2/1 sur un autre trade.
    const { m1, m2 } = partagerMoities(TROIS_TRADES, 20);
    expect(m1.map((t) => t.idxEntree)).toEqual([2, 8]);
    expect(m2.map((t) => t.idxEntree)).toEqual([12]);
  });

  it("range un trade à cheval sur la frontière dans la moitié de son ENTRÉE", () => {
    // Entrée 8 < 10 ≤ sortie 10 : la 1re moitié le garde en entier.
    const { m1, m2 } = partagerMoities([trade(8, 10, -5)], 20);
    expect(m1).toHaveLength(1);
    expect(m2).toHaveLength(0);
  });

  it("nbCandles impair : frontière = floor(n / 2)", () => {
    const { m1, m2 } = partagerMoities([trade(1, 2, 1), trade(2, 3, 1)], 5); // milieu = 2
    expect(m1.map((t) => t.idxEntree)).toEqual([1]);
    expect(m2.map((t) => t.idxEntree)).toEqual([2]);
  });
});
