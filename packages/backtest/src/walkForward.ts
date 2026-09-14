/**
 * @axiom/backtest — walkForward.ts
 *
 * Partage PUR d'un résultat de backtest en deux moitiés TEMPORELLES, pour lire la
 * tenue d'une stratégie hors de l'échantillon où l'on a réglé ses paramètres : un
 * edge qui n'existe que sur une moitié est un edge suspect. Aucun réglage n'est
 * optimisé ici — c'est un simple découpage du run déjà exécuté, jamais un second run.
 *
 * Conventions FIGÉES (alignées sur `partagerMoities` de statsRejeu.ts) :
 *  - la frontière est le MILIEU des bougies testées (index `floor(nbBougies / 2)`),
 *    donc du temps calendaire à cadence régulière — pas la médiane des trades ;
 *  - un trade est rangé selon sa date d'ENTRÉE ; il peut chevaucher la frontière et sa
 *    sortie compte alors dans la 1re moitié ;
 *  - le PnL d'une moitié est la somme des PnL nets de ses trades (même convention que
 *    `StatsBacktest.pnlTotal`), rapporté à l'ÉQUITÉ AU DÉBUT de la moitié ;
 *  - le drawdown est recalculé DANS chaque moitié, pic réinitialisé à l'équité de
 *    début de moitié : le pic historique de la 1re moitié ne creuse pas la 2e.
 */

import type { PointEquity, ResultatBacktest, TradeResultat } from "./types";

/** Agrégats d'une moitié temporelle d'un backtest. */
export interface StatsMoitie {
  /** Première borne temporelle de la moitié (ms epoch, incluse). */
  debut: number;
  /** Dernière borne temporelle de la moitié (ms epoch) : frontière pour la 1re, fin de série pour la 2e. */
  fin: number;
  nbTrades: number;
  /** Taux de réussite en % (pnl > 0). */
  winRatePct: number;
  /** Σ gains / Σ |pertes| ; Infinity sans perte, 0 sans gain. */
  profitFactor: number;
  /** Somme des PnL nets des trades de la moitié, en cotation. */
  pnlTotal: number;
  /** `pnlTotal` en % de l'équité au début de la moitié. */
  pnlTotalPct: number;
  /** Pire retracement pic → creux DANS la moitié, en % du pic (positif ou 0). */
  maxDrawdownPct: number;
  /** Nombre de trades à R défini. */
  nbTradesR: number;
  /** Moyenne des R nets (null si aucun trade à R). */
  expectancyR: number | null;
}

/** Les deux moitiés d'un run et leur frontière. */
export interface PartageMoities {
  /** ms epoch de la bougie médiane : 1re moitié = [debut, frontiere[, 2e = [frontiere, fin]. */
  frontiere: number;
  m1: StatsMoitie;
  m2: StatsMoitie;
}

/** Drawdown maximal d'une suite d'équités, pic initialisé à `picInitial`. */
function maxDrawdownDepuis(points: readonly PointEquity[], picInitial: number): number {
  let pic = picInitial;
  let max = 0;
  for (const p of points) {
    if (p.equity > pic) pic = p.equity;
    const dd = pic > 0 ? ((pic - p.equity) / pic) * 100 : 0;
    if (dd > max) max = dd;
  }
  return max;
}

function statsMoitie(
  trades: readonly TradeResultat[],
  points: readonly PointEquity[],
  capitalDebut: number,
  debut: number,
  fin: number,
): StatsMoitie {
  let sommeGains = 0;
  let sommePertes = 0;
  let pnlTotal = 0;
  let nbGagnants = 0;
  let sommeR = 0;
  let nbTradesR = 0;
  for (const t of trades) {
    pnlTotal += t.pnl;
    if (t.pnl > 0) {
      nbGagnants += 1;
      sommeGains += t.pnl;
    } else if (t.pnl < 0) {
      sommePertes += -t.pnl;
    }
    if (t.r !== null && Number.isFinite(t.r)) {
      sommeR += t.r;
      nbTradesR += 1;
    }
  }
  const nbTrades = trades.length;
  return {
    debut,
    fin,
    nbTrades,
    winRatePct: nbTrades > 0 ? (nbGagnants / nbTrades) * 100 : 0,
    profitFactor: sommePertes > 0 ? sommeGains / sommePertes : sommeGains > 0 ? Infinity : 0,
    pnlTotal,
    pnlTotalPct: capitalDebut > 0 ? (pnlTotal / capitalDebut) * 100 : 0,
    maxDrawdownPct: maxDrawdownDepuis(points, capitalDebut),
    nbTradesR,
    expectancyR: nbTradesR > 0 ? sommeR / nbTradesR : null,
  };
}

/**
 * Partage un résultat en deux moitiés temporelles. `null` si le run ne compte pas au
 * moins deux bougies ou si sa courbe d'équité ne porte pas la bougie médiane (l'équité
 * du moteur contient un point initial puis un point par bougie).
 */
export function partagerResultatMoities(resultat: ResultatBacktest): PartageMoities | null {
  const { trades, equity, nbBougies } = resultat;
  if (nbBougies < 2) return null;
  const frontiere = equity[Math.floor(nbBougies / 2) + 1]?.temps;
  const debut = equity[0]?.temps;
  const fin = equity[equity.length - 1]?.temps;
  if (frontiere === undefined || debut === undefined || fin === undefined) return null;

  const points1 = equity.filter((p) => p.temps < frontiere);
  const points2 = equity.filter((p) => p.temps >= frontiere);
  const capital1 = equity[0]!.equity;
  const capital2 = points1[points1.length - 1]?.equity ?? capital1;

  return {
    frontiere,
    m1: statsMoitie(trades.filter((t) => t.tempsEntree < frontiere), points1, capital1, debut, frontiere),
    m2: statsMoitie(trades.filter((t) => t.tempsEntree >= frontiere), points2, capital2, frontiere, fin),
  };
}
