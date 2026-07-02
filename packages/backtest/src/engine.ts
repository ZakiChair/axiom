/**
 * @axiom/backtest — engine.ts
 *
 * Moteur de backtest ÉVÉNEMENTIEL et PUR (aucune I/O, aucun accès temps réel) sur
 * BOUGIES CLÔTURÉES uniquement. Contrat d'honnêteté, identique à l'étiquette affichée :
 *
 *   1. Les décisions sont prises à la CLÔTURE d'une bougie (index i), en n'utilisant que
 *      des données ≤ i (aucun look-ahead).
 *   2. Les ordres sont exécutés à l'OPEN de la bougie SUIVANTE (i+1). Un signal sur la
 *      DERNIÈRE bougie n'est donc jamais exécuté (pas d'open suivant) — testé explicitement.
 *   3. Stop et objectif sont évalués sur la CLÔTURE (PAS d'intrabar) puis exécutés à
 *      l'open suivant : un pic/creux intrabar qui ne se referme pas au-delà du seuil ne
 *      déclenche RIEN. Choix conservateur et cohérent avec l'étiquette « pas d'intrabar ».
 *   4. Une seule position à la fois (pas de pyramidage). La position encore ouverte à la
 *      fin de la série est marquée au dernier close (raison "fin-donnees").
 *
 * Perf : chaque indicateur référencé est calculé UNE fois sur toute la série (full-array,
 * via @axiom/indicators), mémoïsé par (id + params) ; la boucle de barres ne fait ensuite
 * que lire des valeurs pré-calculées.
 */

import type { Candle, IndicatorResult } from "@axiom/types";
import { computeIndicator, getIndicator } from "@axiom/indicators";
import type {
  ChampPrix,
  Comparateur,
  Condition,
  Direction,
  Operande,
  ParamsBacktest,
  PointEquity,
  RaisonSortie,
  SensPosition,
  StatsBacktest,
  StrategieDef,
  TradeResultat,
  ResultatBacktest,
} from "./types";

/** Millisecondes dans une année (base 365,25 j) — pour l'annualisation du Sharpe. */
const MS_PAR_AN = 365.25 * 24 * 60 * 60 * 1000;

/** Une série alignée sur les bougies : valeur ou undefined (amorce indicateur, champ absent). */
type Serie = Array<number | undefined>;

// ─────────────────────────── Compilation des conditions ───────────────────────────

/** Condition « compilée » : opérandes résolus en séries pré-calculées. */
type ConditionCompilee =
  | { type: "comparaison"; gauche: Serie; droite: Serie; comparateur: Comparateur }
  | { type: "croisement"; a: Serie; b: Serie; sens: "hausse" | "baisse" };

/** Valeur d'un champ OHLCV d'une bougie. */
function valeurChamp(c: Candle, champ: ChampPrix): number {
  switch (champ) {
    case "open":
      return c.open;
    case "high":
      return c.high;
    case "low":
      return c.low;
    case "close":
      return c.close;
    case "volume":
      return c.volume;
  }
}

/**
 * Résout un opérande en série alignée sur `candles`. Les indicateurs sont mémoïsés par
 * (id + params sérialisés) dans `cache` : plusieurs opérandes du même indicateur (mêmes
 * paramètres, sorties différentes) ne le recalculent qu'une fois.
 */
function resoudreOperande(
  op: Operande,
  candles: Candle[],
  cache: Map<string, IndicatorResult>,
): Serie {
  const n = candles.length;
  if (op.type === "constante") {
    return new Array<number | undefined>(n).fill(op.valeur);
  }
  if (op.type === "prix") {
    const out: Serie = new Array<number | undefined>(n);
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      out[i] = c === undefined ? undefined : valeurChamp(c, op.champ);
    }
    return out;
  }
  // Indicateur : calcul mémoïsé.
  const cle = `${op.indicateurId}::${JSON.stringify(op.params)}`;
  let res = cache.get(cle);
  if (res === undefined) {
    const def = getIndicator(op.indicateurId);
    if (def === undefined) return new Array<number | undefined>(n).fill(undefined);
    res = computeIndicator(def, candles, op.params);
    cache.set(cle, res);
  }
  const serie = res.series[op.output];
  return serie ?? new Array<number | undefined>(n).fill(undefined);
}

/** Compile une liste de conditions (opérandes → séries pré-calculées). */
function compilerRegles(
  conditions: Condition[],
  candles: Candle[],
  cache: Map<string, IndicatorResult>,
): ConditionCompilee[] {
  return conditions.map((c) =>
    c.type === "comparaison"
      ? {
          type: "comparaison" as const,
          gauche: resoudreOperande(c.gauche, candles, cache),
          droite: resoudreOperande(c.droite, candles, cache),
          comparateur: c.comparateur,
        }
      : {
          type: "croisement" as const,
          a: resoudreOperande(c.a, candles, cache),
          b: resoudreOperande(c.b, candles, cache),
          sens: c.sens,
        },
  );
}

// ─────────────────────────── Évaluation à une barre ───────────────────────────

/** Applique un comparateur. PURE. */
function comparer(x: number, op: Comparateur, y: number): boolean {
  switch (op) {
    case ">":
      return x > y;
    case ">=":
      return x >= y;
    case "<":
      return x < y;
    case "<=":
      return x <= y;
  }
}

/** Valeur finie de la série `s` à l'index `i`, sinon undefined. */
function valeurFinie(s: Serie, i: number): number | undefined {
  const v = s[i];
  return v !== undefined && Number.isFinite(v) ? v : undefined;
}

/** Évalue UNE condition compilée à la barre `i` (false si valeurs indisponibles). */
function evaluerCondition(cc: ConditionCompilee, i: number): boolean {
  if (cc.type === "comparaison") {
    const g = valeurFinie(cc.gauche, i);
    const d = valeurFinie(cc.droite, i);
    if (g === undefined || d === undefined) return false;
    return comparer(g, cc.comparateur, d);
  }
  // Croisement : nécessite les deux dernières barres (i-1, i) définies.
  if (i < 1) return false;
  const a0 = valeurFinie(cc.a, i - 1);
  const b0 = valeurFinie(cc.b, i - 1);
  const a1 = valeurFinie(cc.a, i);
  const b1 = valeurFinie(cc.b, i);
  if (a0 === undefined || b0 === undefined || a1 === undefined || b1 === undefined) return false;
  return cc.sens === "hausse" ? a0 <= b0 && a1 > b1 : a0 >= b0 && a1 < b1;
}

/**
 * Toutes les conditions vraies à la barre `i` (ET conjonctif). Une liste VIDE renvoie
 * FALSE : pas de règle = pas de signal (évite toute entrée/sortie fantôme).
 */
function toutesVraies(regles: ConditionCompilee[], i: number): boolean {
  if (regles.length === 0) return false;
  for (const r of regles) if (!evaluerCondition(r, i)) return false;
  return true;
}

// ─────────────────────────── Fills (slippage) et PnL ───────────────────────────

/**
 * Prix de fill dégradé par le slippage : à l'ENTRÉE on paie plus cher (long) ou on vend
 * moins cher (short) ; à la SORTIE l'inverse. `signe` = +1 dégrade vers le haut.
 */
function appliquerSlippage(prix: number, slippagePct: number, hausse: boolean): number {
  const f = slippagePct / 100;
  return hausse ? prix * (1 + f) : prix * (1 - f);
}

/** Prix de fill d'ENTRÉE (long → paie plus cher, short → vend moins cher). */
function fillEntree(open: number, sens: SensPosition, slippagePct: number): number {
  return appliquerSlippage(open, slippagePct, sens === "long");
}

/** Prix de fill de SORTIE (clôture d'un long → vend moins cher, d'un short → rachète plus cher). */
function fillSortie(prix: number, sens: SensPosition, slippagePct: number): number {
  return appliquerSlippage(prix, slippagePct, sens === "short");
}

/** Position ouverte en cours (interne au moteur). */
interface PositionOuverte {
  sens: SensPosition;
  prixEntree: number;
  quantite: number;
  tempsEntree: number;
  indexEntree: number;
}

/**
 * Clôt une position et produit le trade net. PnL brut = qté · (sortie − entrée) pour un
 * long (inversé pour un short) ; frais = fraisPct sur le notionnel de CHAQUE côté.
 */
function cloturerTrade(
  pos: PositionOuverte,
  prixSortie: number,
  tempsSortie: number,
  indexSortie: number,
  raison: RaisonSortie,
  strat: StrategieDef,
  params: ParamsBacktest,
): TradeResultat {
  const notionnelEntree = pos.quantite * pos.prixEntree; // ≈ strat.tailleFixe
  const notionnelSortie = pos.quantite * prixSortie;
  const brut =
    pos.sens === "long"
      ? pos.quantite * (prixSortie - pos.prixEntree)
      : pos.quantite * (pos.prixEntree - prixSortie);
  const frais = (notionnelEntree + notionnelSortie) * (params.fraisPct / 100);
  const pnl = brut - frais;
  const pnlPct = strat.tailleFixe > 0 ? (pnl / strat.tailleFixe) * 100 : 0;
  return {
    sens: pos.sens,
    tempsEntree: pos.tempsEntree,
    prixEntree: pos.prixEntree,
    tempsSortie,
    prixSortie,
    raison,
    quantite: pos.quantite,
    pnl,
    pnlPct,
    frais,
    dureeBarres: indexSortie - pos.indexEntree,
    dureeMs: tempsSortie - pos.tempsEntree,
  };
}

// ─────────────────────────── Décision de sortie ───────────────────────────

/**
 * Décide si une position doit être clôturée à la CLÔTURE de la barre `i` (pas d'intrabar).
 * Priorité : stop, puis objectif, puis règle de sortie. En mode "les-deux", une position
 * longue se ferme sur signal SHORT (reglesSortie), une courte sur signal LONG (reglesEntree).
 */
function decisionSortie(
  pos: PositionOuverte,
  cloture: number,
  strat: StrategieDef,
  entree: ConditionCompilee[],
  sortie: ConditionCompilee[],
  i: number,
  direction: Direction,
): RaisonSortie | null {
  if (strat.stopPct !== undefined && strat.stopPct > 0) {
    const seuil =
      pos.sens === "long"
        ? pos.prixEntree * (1 - strat.stopPct / 100)
        : pos.prixEntree * (1 + strat.stopPct / 100);
    const touche = pos.sens === "long" ? cloture <= seuil : cloture >= seuil;
    if (touche) return "stop";
  }
  if (strat.targetPct !== undefined && strat.targetPct > 0) {
    const seuil =
      pos.sens === "long"
        ? pos.prixEntree * (1 + strat.targetPct / 100)
        : pos.prixEntree * (1 - strat.targetPct / 100);
    const touche = pos.sens === "long" ? cloture >= seuil : cloture <= seuil;
    if (touche) return "target";
  }
  const signalFermeture =
    direction === "les-deux"
      ? pos.sens === "long"
        ? toutesVraies(sortie, i)
        : toutesVraies(entree, i)
      : toutesVraies(sortie, i);
  return signalFermeture ? "regle" : null;
}

// ─────────────────────────── Boucle principale ───────────────────────────

/**
 * Exécute un backtest. `candles` DOIT être une série de bougies clôturées, en ordre
 * chronologique croissant. Renvoie trades, equity curve et statistiques.
 */
export function runBacktest(
  candles: Candle[],
  strat: StrategieDef,
  params: ParamsBacktest,
): ResultatBacktest {
  const n = candles.length;
  const cache = new Map<string, IndicatorResult>();
  const entree = compilerRegles(strat.reglesEntree, candles, cache);
  const sortie = compilerRegles(strat.reglesSortie, candles, cache);
  const direction = strat.direction;

  const trades: TradeResultat[] = [];
  let pos: PositionOuverte | null = null;

  // i = barre de DÉCISION (clôturée) ; i+1 = barre de FILL (son open). On s'arrête à
  // n-2 pour qu'un open suivant existe toujours : un signal sur la dernière barre n'est
  // donc jamais exécutable (invariant no-look-ahead).
  for (let i = 0; i < n - 1; i++) {
    const barreDecision = candles[i];
    const barreFill = candles[i + 1];
    if (barreDecision === undefined || barreFill === undefined) continue;

    if (pos === null) {
      // À plat : décider une éventuelle ouverture.
      let sensOuvrir: SensPosition | null = null;
      if (direction === "long") {
        if (toutesVraies(entree, i)) sensOuvrir = "long";
      } else if (direction === "short") {
        if (toutesVraies(entree, i)) sensOuvrir = "short";
      } else {
        // les-deux : entree = signal long, sortie = signal short.
        if (toutesVraies(entree, i)) sensOuvrir = "long";
        else if (toutesVraies(sortie, i)) sensOuvrir = "short";
      }
      if (sensOuvrir !== null) {
        const prixEntree = fillEntree(barreFill.open, sensOuvrir, params.slippagePct);
        if (prixEntree > 0) {
          pos = {
            sens: sensOuvrir,
            prixEntree,
            quantite: strat.tailleFixe / prixEntree,
            tempsEntree: barreFill.time,
            indexEntree: i + 1,
          };
        }
      }
    } else {
      // En position : décider une éventuelle clôture (à la clôture de la barre i).
      const raison = decisionSortie(pos, barreDecision.close, strat, entree, sortie, i, direction);
      if (raison !== null) {
        const prixSortie = fillSortie(barreFill.open, pos.sens, params.slippagePct);
        trades.push(cloturerTrade(pos, prixSortie, barreFill.time, i + 1, raison, strat, params));
        pos = null;
        // Pas de réouverture sur la même barre : un éventuel retournement (les-deux) aura
        // lieu à une itération ULTÉRIEURE (préserve « une position à la fois »).
      }
    }
  }

  // Position résiduelle : marquée au dernier close (aucun open suivant disponible).
  if (pos !== null && n > 0) {
    const derniere = candles[n - 1];
    if (derniere !== undefined) {
      const prixSortie = fillSortie(derniere.close, pos.sens, params.slippagePct);
      trades.push(
        cloturerTrade(pos, prixSortie, derniere.time, n - 1, "fin-donnees", strat, params),
      );
      pos = null;
    }
  }

  const equity = construireEquity(trades, candles, params.capitalInitial);
  const stats = calculerStats(trades, equity, candles, params.capitalInitial);
  return { trades, equity, stats, nbBougies: n };
}

// ─────────────────────────── Equity curve & drawdown ───────────────────────────

/**
 * Construit l'equity curve : point initial (capital, 1re bougie) puis un point par trade
 * (capital cumulé + drawdown vs plus haut atteint). PURE.
 */
export function construireEquity(
  trades: TradeResultat[],
  candles: Candle[],
  capitalInitial: number,
): PointEquity[] {
  const t0 = candles[0]?.time ?? 0;
  const points: PointEquity[] = [{ temps: t0, equity: capitalInitial, drawdownPct: 0 }];
  let capital = capitalInitial;
  let pic = capitalInitial;
  for (const t of trades) {
    capital += t.pnl;
    if (capital > pic) pic = capital;
    const dd = pic > 0 ? ((pic - capital) / pic) * 100 : 0;
    points.push({ temps: t.tempsSortie, equity: capital, drawdownPct: dd });
  }
  return points;
}

// ─────────────────────────── Statistiques ───────────────────────────

/** Moyenne d'un tableau (0 si vide). PURE. */
function moyenne(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/**
 * Sharpe simple ANNUALISÉ depuis des rendements par trade. PURE & testée directement.
 *
 * Sharpe brut = moyenne(rendements) / écart-type d'échantillon (dénominateur n−1).
 * Annualisation par racine du nombre de trades par an : `sharpe = brut · √tradesParAn`.
 * Renvoie 0 si moins de 2 trades ou écart-type nul (indéfini).
 */
export function sharpeAnnualise(rendements: number[], tradesParAn: number): number {
  const n = rendements.length;
  if (n < 2) return 0;
  const mu = moyenne(rendements);
  let sse = 0;
  for (const r of rendements) sse += (r - mu) * (r - mu);
  const ecartType = Math.sqrt(sse / (n - 1));
  if (ecartType === 0) return 0;
  const facteur = tradesParAn > 0 ? Math.sqrt(tradesParAn) : 1;
  return (mu / ecartType) * facteur;
}

/** Agrège les statistiques d'un backtest. PURE. */
export function calculerStats(
  trades: TradeResultat[],
  equity: PointEquity[],
  candles: Candle[],
  capitalInitial: number,
): StatsBacktest {
  const nbTrades = trades.length;
  const gagnants = trades.filter((t) => t.pnl > 0);
  const perdants = trades.filter((t) => t.pnl < 0);

  let sommeGains = 0;
  for (const t of gagnants) sommeGains += t.pnl;
  let sommePertes = 0;
  for (const t of perdants) sommePertes += -t.pnl;

  const profitFactor = sommePertes > 0 ? sommeGains / sommePertes : sommeGains > 0 ? Infinity : 0;

  let pnlTotal = 0;
  for (const t of trades) pnlTotal += t.pnl;

  const maxDrawdownPct = equity.reduce((m, p) => (p.drawdownPct > m ? p.drawdownPct : m), 0);

  // Rendements par trade (fraction du capital engagé) pour le Sharpe.
  const rendements = trades.map((t) => t.pnlPct / 100);
  const premier = trades[0];
  const dernier = trades[nbTrades - 1];
  const spanMs = premier && dernier ? dernier.tempsSortie - premier.tempsEntree : 0;
  const anneesSpan = spanMs > 0 ? spanMs / MS_PAR_AN : 0;
  const tradesParAn = anneesSpan > 0 ? nbTrades / anneesSpan : nbTrades;
  const sharpe = sharpeAnnualise(rendements, tradesParAn);

  // Exposition : somme des durées en position / durée totale de la série.
  let sommeDuree = 0;
  for (const t of trades) sommeDuree += t.dureeMs;
  const dureeTotale =
    candles.length > 1 ? (candles[candles.length - 1]?.time ?? 0) - (candles[0]?.time ?? 0) : 0;
  const expositionPct = dureeTotale > 0 ? (sommeDuree / dureeTotale) * 100 : 0;

  return {
    nbTrades,
    nbGagnants: gagnants.length,
    nbPerdants: perdants.length,
    winRatePct: nbTrades > 0 ? (gagnants.length / nbTrades) * 100 : 0,
    profitFactor,
    pnlTotal,
    pnlTotalPct: capitalInitial > 0 ? (pnlTotal / capitalInitial) * 100 : 0,
    maxDrawdownPct,
    sharpe,
    expositionPct,
    gainMoyenPct: moyenne(gagnants.map((t) => t.pnlPct)),
    perteMoyennePct: moyenne(perdants.map((t) => t.pnlPct)),
  };
}
