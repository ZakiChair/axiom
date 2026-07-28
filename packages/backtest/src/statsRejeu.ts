/**
 * @axiom/backtest — statsRejeu.ts
 *
 * Statistiques PURES d'un rejeu « chart-fidèle » : agrégats sur les
 * `TradeStrategie` reconstruits par `construireTradesStrategie`
 * (@axiom/indicators), c'est-à-dire des trades close-à-close **hors frais et
 * hors slippage** — exactement ce que les marqueurs de la fabrique affichent.
 * Sert la campagne de validation des stratégies (`scripts/valider-strategies.ts`).
 *
 * Ce module ne remplace PAS `calculerStats` de `engine.ts` : celui-là mesure une
 * EXÉCUTION (fill à l'open de la barre suivante, frais, slippage, capital) ;
 * celui-ci mesure un SIGNAL. Les deux sont volontairement rendus côte à côte
 * dans le rapport de campagne pour que l'écart devienne une mesure.
 *
 * Conventions FIGÉES (divergences assumées avec `StatsBacktest`) :
 *  - `winRate` compte les trades à `pnlPct >= 0` (un trade nul est « gagnant »,
 *    puisque hors frais il ne coûte rien) ;
 *  - `pnlComposePct` compose les rendements (Π(1 + pnl/100) − 1) au lieu de les
 *    additionner : réinvestissement intégral, pas de taille fixe ;
 *  - `maxDrawdownPct` est NÉGATIF ou nul (ex. −5.0), là où
 *    `StatsBacktest.maxDrawdownPct` est positif — étiqueter les colonnes du
 *    rapport en conséquence ;
 *  - seuls les trades CLOS (`pnlPct`/`idxSortie` définis) sont pris en compte ;
 *    un trade encore ouvert (le `ouvert` de `construireTradesStrategie`) est
 *    ignoré en silence, jamais marqué au marché.
 */

import type { TradeStrategie } from "@axiom/indicators";

/** Agrégats d'un rejeu de stratégie (pnlPct signés, hors frais). */
export interface StatsRejeu {
  nbTrades: number;
  /** % de trades à pnlPct >= 0. */
  winRate: number;
  /** Moyenne des pnlPct, en %. */
  expectancy: number;
  /** Π(1 + pnl/100) − 1, en %. */
  pnlComposePct: number;
  /** Pire retracement pic → creux de l'equity composée, en % (négatif ou 0). */
  maxDrawdownPct: number;
  /** Durée moyenne des trades, en bougies. */
  dureeMoyenne: number;
}

/** Stats d'une liste VIDE : tout à zéro (jamais de NaN dans le rapport). */
const STATS_VIDES: StatsRejeu = {
  nbTrades: 0,
  winRate: 0,
  expectancy: 0,
  pnlComposePct: 0,
  maxDrawdownPct: 0,
  dureeMoyenne: 0,
};

/**
 * Agrégats PURS d'une liste de trades. Les trades non clos sont filtrés ; une
 * liste vide (ou entièrement non close) renvoie `STATS_VIDES` — une stratégie
 * sans trade sur une cellule est un résultat normal de la campagne, pas une
 * erreur, et ne doit pas empoisonner les tableaux avec des NaN.
 */
export function statsTrades(trades: TradeStrategie[]): StatsRejeu {
  const clos = trades.filter(
    (t): t is TradeStrategie & { idxSortie: number; pnlPct: number } =>
      t.idxSortie !== undefined && t.pnlPct !== undefined && Number.isFinite(t.pnlPct)
  );
  const nbTrades = clos.length;
  if (nbTrades === 0) return { ...STATS_VIDES };

  let sommePnl = 0;
  let sommeDuree = 0;
  let nbGagnants = 0;
  let equity = 1;
  let pic = 1;
  let maxDrawdownPct = 0;

  for (const t of clos) {
    sommePnl += t.pnlPct;
    sommeDuree += t.idxSortie - t.idxEntree;
    if (t.pnlPct >= 0) nbGagnants++;
    equity *= 1 + t.pnlPct / 100;
    if (equity > pic) pic = equity;
    const dd = ((equity - pic) / pic) * 100; // <= 0
    if (dd < maxDrawdownPct) maxDrawdownPct = dd;
  }

  return {
    nbTrades,
    winRate: (nbGagnants / nbTrades) * 100,
    expectancy: sommePnl / nbTrades,
    pnlComposePct: (equity - 1) * 100,
    maxDrawdownPct,
    dureeMoyenne: sommeDuree / nbTrades,
  };
}

/**
 * Coupe une liste de trades en deux moitiés TEMPORELLES : la frontière est le
 * MILIEU du tableau de bougies (`floor(nbCandles / 2)`), pas la médiane du
 * nombre de trades — c'est bien du temps calendaire qui est partagé, condition
 * de l'anti-overfit du spec (« chaque mesure rendue séparément sur les deux
 * moitiés temporelles »). Un trade est rangé selon son index d'ENTRÉE : il peut
 * donc chevaucher la frontière, et sa sortie compte dans la 1re moitié.
 */
export function partagerMoities(
  trades: TradeStrategie[],
  nbCandles: number
): { m1: TradeStrategie[]; m2: TradeStrategie[] } {
  const milieu = Math.floor(nbCandles / 2);
  const m1: TradeStrategie[] = [];
  const m2: TradeStrategie[] = [];
  for (const t of trades) {
    if (t.idxEntree < milieu) m1.push(t);
    else m2.push(t);
  }
  return { m1, m2 };
}
