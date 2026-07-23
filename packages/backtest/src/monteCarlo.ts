/**
 * @axiom/backtest — monteCarlo.ts
 *
 * Rééchantillonnage Monte-Carlo (bootstrap AVEC remise) des PnL de trades d'un backtest.
 * À partir de la liste des PnL réalisés (champ `pnl` de `TradeResultat`, en cotation) et
 * du capital initial (`ParamsBacktest.capitalInitial`), on simule `nChemins` réordonnancements
 * possibles de la même population de trades : chaque chemin tire, AVEC remise, autant de PnL
 * qu'il y a de trades, et cumule un chemin d'equity (capital + PnL cumulés).
 *
 * On en extrait le cône de percentiles d'equity (p5/p50/p95 par pas), les percentiles de
 * l'equity finale, ceux du max drawdown et la probabilité de ruine.
 *
 * Module PUR et sans I/O : le générateur aléatoire est INJECTÉ (jamais Math.random ici), ce
 * qui rend tout déterministe à seed fixe.
 */

/**
 * RNG déterministe et seedable (mulberry32). Renvoie une fonction sans argument produisant
 * une valeur pseudo-aléatoire dans [0, 1). Même seed → même séquence.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Résultat agrégé d'un run Monte-Carlo. */
export interface ResultatMonteCarlo {
  /** Percentiles de l'equity finale (dernier pas de chaque chemin). */
  equityFinale: { p5: number; p25: number; p50: number; p75: number; p95: number };
  /** Percentiles du max drawdown, en FRACTION du capital initial (0.25 = −25 %). */
  maxDrawdown: { p50: number; p95: number };
  /** Part des chemins finissant avec une equity < 0. */
  probRuine: number;
  /** Equity cumulée par pas (longueur = nb trades) pour tracer le cône. */
  cheminsPercentiles: { p5: number[]; p50: number[]; p95: number[] };
}

/**
 * Percentile par interpolation linéaire (convention « type 7 » de R / numpy `linear`,
 * identique à la médiane usuelle) sur un tableau DÉJÀ TRIÉ croissant.
 * Rang réel = p · (n − 1) ; interpolation linéaire entre les deux voisins entiers.
 * @param trie  échantillon trié croissant (longueur ≥ 1)
 * @param p     percentile dans [0, 1]
 */
function percentileTrie(trie: number[], p: number): number {
  const n = trie.length;
  if (n === 1) return trie[0]!;
  const rang = p * (n - 1);
  const bas = Math.floor(rang);
  const haut = Math.ceil(rang);
  if (bas === haut) return trie[bas]!;
  const frac = rang - bas;
  return trie[bas]! + (trie[haut]! - trie[bas]!) * frac;
}

/**
 * Rééchantillonnage Monte-Carlo des PnL de trades.
 *
 * @param pnls           PnL réalisés par trade (champ `pnl`), en cotation.
 * @param nChemins       nb de simulations ; borné à [1, 2000].
 * @param rng            générateur injecté renvoyant [0, 1) (ex. mulberry32).
 * @param capitalInitial capital de départ de l'equity curve.
 * @returns              le résultat agrégé, ou `null` si moins de 10 trades.
 */
export function monteCarloTrades(
  pnls: number[],
  nChemins: number,
  rng: () => number,
  capitalInitial: number,
): ResultatMonteCarlo | null {
  const nTrades = pnls.length;
  if (nTrades < 10) return null;

  // Borne le nombre de chemins à [1, 2000].
  const chemins = Math.max(1, Math.min(2000, Math.floor(nChemins)));

  // Colonnes d'equity : equityParPas[i] rassemble, pour le pas i, l'equity de tous les chemins.
  const equityParPas: number[][] = Array.from({ length: nTrades }, () => new Array(chemins));
  const equitesFinales = new Array<number>(chemins);
  const drawdowns = new Array<number>(chemins);
  let nbRuine = 0;

  for (let c = 0; c < chemins; c++) {
    let capital = capitalInitial;
    let pic = capitalInitial; // pic initialisé au capital : une 1re perte compte comme drawdown
    let ddMax = 0;
    for (let i = 0; i < nTrades; i++) {
      // Tirage AVEC remise : exactement un rng() par trade rééchantillonné.
      const idx = Math.floor(rng() * nTrades);
      capital += pnls[idx]!;
      equityParPas[i]![c] = capital;
      if (capital > pic) pic = capital;
      // Drawdown rapporté au CAPITAL INITIAL (pas au pic) — convention du contrôleur.
      const dd = (pic - capital) / capitalInitial;
      if (dd > ddMax) ddMax = dd;
    }
    equitesFinales[c] = capital;
    drawdowns[c] = ddMax;
    if (capital < 0) nbRuine++;
  }

  // Percentiles de l'equity finale.
  const finalesTriees = [...equitesFinales].sort((a, b) => a - b);
  const equityFinale = {
    p5: percentileTrie(finalesTriees, 0.05),
    p25: percentileTrie(finalesTriees, 0.25),
    p50: percentileTrie(finalesTriees, 0.5),
    p75: percentileTrie(finalesTriees, 0.75),
    p95: percentileTrie(finalesTriees, 0.95),
  };

  // Percentiles du max drawdown.
  const ddTries = [...drawdowns].sort((a, b) => a - b);
  const maxDrawdown = {
    p50: percentileTrie(ddTries, 0.5),
    p95: percentileTrie(ddTries, 0.95),
  };

  // Cône : percentiles d'equity pas à pas.
  const p5: number[] = new Array(nTrades);
  const p50: number[] = new Array(nTrades);
  const p95: number[] = new Array(nTrades);
  for (let i = 0; i < nTrades; i++) {
    const colonne = equityParPas[i]!.sort((a, b) => a - b);
    p5[i] = percentileTrie(colonne, 0.05);
    p50[i] = percentileTrie(colonne, 0.5);
    p95[i] = percentileTrie(colonne, 0.95);
  }

  return {
    equityFinale,
    maxDrawdown,
    probRuine: nbRuine / chemins,
    cheminsPercentiles: { p5, p50, p95 },
  };
}
