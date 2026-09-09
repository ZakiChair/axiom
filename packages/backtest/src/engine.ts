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
import { computeIndicator, getIndicator, supportsIndicatorTimeframe } from "@axiom/indicators";
import type {
  ChampPrix,
  Comparateur,
  Condition,
  Direction,
  CoutFunding,
  Operande,
  ParamsBacktest,
  PointEquity,
  RaisonSortie,
  ReglementFunding,
  SensPosition,
  StatsBacktest,
  StrategieDef,
  TradeResultat,
  ResultatBacktest,
} from "./types";

/** Millisecondes dans une année (base 365,25 j) — pour l'annualisation du Sharpe. */
const MS_PAR_AN = 365.25 * 24 * 60 * 60 * 1000;

/** Durées fixes autorisées pour dater les clôtures sans inférer depuis l'open suivant. */
const DUREE_TIMEFRAME_MS: Partial<Record<NonNullable<ParamsBacktest["timeframe"]>, number>> = {
  "1s": 1_000, "5s": 5_000, "15s": 15_000,
  "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "6h": 21_600_000,
  "12h": 43_200_000, "1d": 86_400_000, "3d": 259_200_000, "1w": 604_800_000,
};

function dureeTimeframeFixeMs(timeframe: ParamsBacktest["timeframe"]): number | null {
  return timeframe === undefined ? null : DUREE_TIMEFRAME_MS[timeframe] ?? null;
}

/** Une série alignée sur les bougies : valeur ou undefined (amorce indicateur, champ absent). */
type Serie = Array<number | undefined>;

const SORTIES_NON_CAUSALES = new Set([
  "ichimoku:chikou",
  "fractals:up",
  "fractals:down",
  "pivotHighLow:pivotHigh",
  "pivotHighLow:pivotLow",
  "zigzag:zigzag",
]);

function operandes(conditions: readonly Condition[]): Operande[] {
  const resultat: Operande[] = [];
  for (const condition of conditions) {
    if (condition.type === "comparaison") resultat.push(condition.gauche, condition.droite);
    else resultat.push(condition.a, condition.b);
  }
  return resultat;
}

/** Refuse les séries qui réécrivent une barre après observation de son futur. */
export function raisonOperandeNonCausale(conditions: readonly Condition[]): string | null {
  for (const op of operandes(conditions)) {
    if (op.type !== "indicateur") continue;
    const cle = `${op.indicateurId}:${op.output}`;
    if (SORTIES_NON_CAUSALES.has(cle)) {
      return `Sortie non causale interdite en backtest : ${cle}.`;
    }
  }
  return null;
}

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
  /** Niveau de stop FIGÉ à l'entrée (null = pas de stop). */
  niveauStop: number | null;
}

function validerReglementsFunding(reglements: readonly ReglementFunding[]): void {
  let precedent = Number.NEGATIVE_INFINITY;
  for (const r of reglements) {
    if (!Number.isFinite(r.temps) || r.temps <= precedent) {
      throw new Error("Funding invalide : timestamps strictement croissants et uniques requis.");
    }
    if (!Number.isFinite(r.taux)) throw new Error("Funding invalide : taux fini requis.");
    if (!Number.isFinite(r.mark) || r.mark <= 0) throw new Error("Funding invalide : mark fini et positif requis.");
    if (!Number.isFinite(r.tempsMark) || r.tempsMark > r.temps) {
      throw new Error("Funding invalide : tempsMark doit être fini et antérieur ou égal au règlement.");
    }
    precedent = r.temps;
  }
}

/**
 * Funding d'un perp linéaire. Convention de simultanéité : règlement puis fills,
 * donc `entrée < règlement <= sortie effective`.
 */
export function calculerFundingTrade(
  sens: SensPosition,
  quantite: number,
  tempsEntree: number,
  instantSortieEffectif: number,
  reglements: readonly ReglementFunding[],
): { total: number; reglements: CoutFunding[] } {
  validerReglementsFunding(reglements);
  if (!Number.isFinite(quantite) || quantite <= 0) throw new Error("Funding invalide : quantité finie et positive requise.");
  if (!Number.isFinite(tempsEntree) || !Number.isFinite(instantSortieEffectif) || instantSortieEffectif < tempsEntree) {
    throw new Error("Funding invalide : bornes temporelles finies et ordonnées requises.");
  }
  const signe = sens === "long" ? 1 : -1;
  const journal: CoutFunding[] = [];
  let total = 0;
  for (const r of reglements) {
    if (r.temps <= tempsEntree) continue;
    if (r.temps > instantSortieEffectif) break;
    const cout = signe * Math.abs(quantite) * r.mark * r.taux;
    journal.push({ temps: r.temps, cout });
    total += cout;
  }
  return { total, reglements: journal };
}

/**
 * Clôt une position et produit le trade net. PnL brut = qté · (sortie − entrée) pour un
 * long (inversé pour un short) ; frais = fraisPct sur le notionnel de CHAQUE côté.
 */
function cloturerTrade(
  pos: PositionOuverte,
  prixSortie: number,
  tempsSortie: number,
  instantSortieEffectif: number,
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
  const calculFunding = params.funding === undefined
    ? null
    : calculerFundingTrade(pos.sens, pos.quantite, pos.tempsEntree, instantSortieEffectif, params.funding.reglements);
  const funding = calculFunding?.total ?? 0;
  const pnl = brut - frais - funding;
  const notionnel = pos.quantite * pos.prixEntree;
  const pnlPct = notionnel > 0 ? (pnl / notionnel) * 100 : 0;
  const distanceStop =
    pos.niveauStop !== null ? Math.abs(pos.prixEntree - pos.niveauStop) : null;
  const risqueInitial =
    distanceStop !== null && distanceStop > 0 ? pos.quantite * distanceStop : null;
  const r = risqueInitial !== null && risqueInitial > 0 ? pnl / risqueInitial : null;
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
    ...(calculFunding === null ? {} : {
      funding,
      reglementsFunding: calculFunding.reglements,
    }),
    ...(calculFunding !== null || instantSortieEffectif !== tempsSortie ? { instantSortieEffectif } : {}),
    dureeBarres: indexSortie - pos.indexEntree,
    dureeMs: instantSortieEffectif - pos.tempsEntree,
    risqueInitial,
    r,
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
  if (pos.niveauStop !== null) {
    const touche = pos.sens === "long" ? cloture <= pos.niveauStop : cloture >= pos.niveauStop;
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
  const nonCausale = raisonOperandeNonCausale([...strat.reglesEntree, ...strat.reglesSortie]);
  if (nonCausale) throw new Error(nonCausale);
  const incompatibilite = raisonTimeframeBacktest([...strat.reglesEntree, ...strat.reglesSortie], params.timeframe);
  if (incompatibilite) throw new Error(incompatibilite);
  const n = candles.length;
  if (params.debutEvaluationMs !== undefined && !Number.isFinite(params.debutEvaluationMs)) {
    throw new Error("debutEvaluationMs doit être fini.");
  }
  if (params.funding !== undefined && params.finDonneesMs === undefined) {
    throw new Error("Funding actif : finDonneesMs réelle requise.");
  }
  if (params.finDonneesMs !== undefined) {
    if (!Number.isFinite(params.finDonneesMs)) throw new Error("finDonneesMs doit être finie.");
    const dernierOpen = candles[n - 1]?.time;
    const dureeTimeframe = dureeTimeframeFixeMs(params.timeframe);
    if (dureeTimeframe === null) {
      throw new Error("finDonneesMs explicite : timeframe fixe requis pour dater la clôture.");
    }
    if (dernierOpen === undefined || params.finDonneesMs !== dernierOpen + dureeTimeframe) {
      throw new Error("finDonneesMs incohérente avec la clôture de la dernière bougie et le timeframe.");
    }
  }
  if (params.funding !== undefined) {
    validerReglementsFunding(params.funding.reglements);
  }
  const cache = new Map<string, IndicatorResult>();
  const entree = compilerRegles(strat.reglesEntree, candles, cache);
  const sortie = compilerRegles(strat.reglesSortie, candles, cache);
  const direction = strat.direction;
  // ATR pré-calculé si stopAtr (retenu même si stopPct est aussi défini).
  const serieAtr: Serie | null =
    strat.stopAtr !== undefined
      ? resoudreOperande(
          { type: "indicateur", indicateurId: "atr", params: { length: strat.stopAtr.length }, output: "atr" },
          candles,
          cache,
        )
      : null;

  const trades: TradeResultat[] = [];
  let pos: PositionOuverte | null = null;

  // i = barre de DÉCISION (clôturée) ; i+1 = barre de FILL (son open). On s'arrête à
  // n-2 pour qu'un open suivant existe toujours : un signal sur la dernière barre n'est
  // donc jamais exécutable (invariant no-look-ahead).
  for (let i = 0; i < n - 1; i++) {
    const barreDecision = candles[i];
    const barreFill = candles[i + 1];
    if (barreDecision === undefined || barreFill === undefined) continue;
    if (params.debutEvaluationMs !== undefined && barreFill.time < params.debutEvaluationMs) continue;

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
          let niveauStop: number | null = null;
          if (serieAtr !== null && strat.stopAtr !== undefined) {
            const atr = valeurFinie(serieAtr, i);
            if (atr === undefined || !(atr > 0)) {
              continue; // ATR indéfini à la barre de décision → pas d'entrée
            }
            niveauStop =
              sensOuvrir === "long"
                ? prixEntree - strat.stopAtr.mult * atr
                : prixEntree + strat.stopAtr.mult * atr;
          } else if (strat.stopPct !== undefined && strat.stopPct > 0) {
            niveauStop =
              sensOuvrir === "long"
                ? prixEntree * (1 - strat.stopPct / 100)
                : prixEntree * (1 + strat.stopPct / 100);
          }
          let quantite = strat.tailleFixe / prixEntree;
          if (
            strat.risquePct !== undefined &&
            strat.risquePct > 0 &&
            niveauStop !== null
          ) {
            const distance = Math.abs(prixEntree - niveauStop);
            if (distance > 0) {
              const risqueUsd = params.capitalInitial * (strat.risquePct / 100);
              quantite = risqueUsd / distance;
            }
          }
          pos = {
            sens: sensOuvrir,
            prixEntree,
            quantite,
            tempsEntree: barreFill.time,
            indexEntree: i + 1,
            niveauStop,
          };
        }
      }
    } else {
      // En position : décider une éventuelle clôture (à la clôture de la barre i).
      const raison = decisionSortie(pos, barreDecision.close, strat, entree, sortie, i, direction);
      if (raison !== null) {
        const prixSortie = fillSortie(barreFill.open, pos.sens, params.slippagePct);
        trades.push(cloturerTrade(pos, prixSortie, barreFill.time, barreFill.time, i + 1, raison, strat, params));
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
        cloturerTrade(
          pos,
          prixSortie,
          derniere.time,
          params.finDonneesMs ?? derniere.time,
          n - 1,
          "fin-donnees",
          strat,
          params,
        ),
      );
      pos = null;
    }
  }

  const candlesMesure = params.debutEvaluationMs === undefined
    ? candles
    : candles.filter((candle) => candle.time >= params.debutEvaluationMs!);
  const equity = construireEquity(trades, candlesMesure, params.capitalInitial, params);
  const stats = calculerStats(trades, equity, candlesMesure, params.capitalInitial, params.finDonneesMs);
  const fundingTotal = params.funding === undefined
    ? undefined
    : trades.reduce((s, trade) => s + (trade.funding ?? 0), 0);
  return { trades, equity, stats, nbBougies: candlesMesure.length, ...(fundingTotal === undefined ? {} : { fundingTotal }) };
}

/** Refus explicite avant calcul : un run sans métadonnée n'invente pas l'intervalle. */
export function raisonTimeframeBacktest(conditions: readonly Condition[], timeframe: ParamsBacktest["timeframe"]): string | null {
  for (const condition of conditions) {
    const operandes = condition.type === "comparaison" ? [condition.gauche, condition.droite] : [condition.a, condition.b];
    for (const op of operandes) {
      if (op.type === "indicateur" && !supportsIndicatorTimeframe(op.indicateurId, timeframe)) return "RVOL saisonnier : intervalle 1h requis.";
    }
  }
  return null;
}

// ─────────────────────────── Equity curve & drawdown ───────────────────────────

/**
 * Construit l'équité à chaque clôture : capital réalisé + PnL latent de la position
 * ouverte, frais d'entrée déjà déduits. Trades et bougies sont chronologiques, avec
 * une seule position à la fois (contrat du moteur). Parcours O(bougies + trades).
 */
export function construireEquity(
  trades: TradeResultat[],
  candles: Candle[],
  capitalInitial: number,
  params?: Pick<ParamsBacktest, "timeframe" | "finDonneesMs" | "funding">,
): PointEquity[] {
  const t0 = candles[0]?.time ?? 0;
  const points: PointEquity[] = [{ temps: t0, equity: capitalInitial, drawdownPct: 0 }];
  let capital = capitalInitial;
  let pic = capitalInitial;
  let indexTrade = 0;
  for (let indexBougie = 0; indexBougie < candles.length; indexBougie++) {
    const bougie = candles[indexBougie]!;
    // Les sorties ordinaires sont exécutées à l'open de cette barre. La sortie
    // fin-donnees se fait à son close : dans les deux cas, le PnL est réalisé au
    // point de clôture. Le net du trade inclut déjà les frais des DEUX côtés.
    while (indexTrade < trades.length) {
      const trade = trades[indexTrade];
      if (trade === undefined || trade.tempsSortie > bougie.time) break;
      capital += trade.pnl;
      indexTrade++;
    }
    let equity = capital;
    const ouverte = trades[indexTrade];
    if (ouverte !== undefined && ouverte.tempsEntree <= bougie.time) {
      const latent = ouverte.quantite * (bougie.close - ouverte.prixEntree) *
        (ouverte.sens === "long" ? 1 : -1);
      // Même taux sur chaque notionnel : cette répartition restitue exactement
      // les frais d'entrée sans modifier le format public de TradeResultat.
      const sommePrix = ouverte.prixEntree + ouverte.prixSortie;
      const fraisEntree = sommePrix > 0 ? ouverte.frais * ouverte.prixEntree / sommePrix : 0;
      let fundingEcoule = 0;
      if (ouverte.reglementsFunding !== undefined) {
        const duree = dureeTimeframeFixeMs(params?.timeframe);
        if (duree === null) throw new Error("Funding actif : timeframe fixe explicite requis pour dater chaque clôture.");
        const derniereBougie = indexBougie === candles.length - 1;
        const finEffective = derniereBougie ? params?.finDonneesMs ?? bougie.time + duree : bougie.time + duree;
        for (const reglement of ouverte.reglementsFunding) {
          if (reglement.temps <= finEffective) fundingEcoule += reglement.cout;
        }
      }
      equity += latent - fraisEntree - fundingEcoule;
    }
    if (equity > pic) pic = equity;
    const dd = pic > 0 ? ((pic - equity) / pic) * 100 : 0;
    points.push({ temps: bougie.time, equity, drawdownPct: dd });
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
  finDonneesMs?: number,
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
  const spanMs = premier && dernier ? (dernier.instantSortieEffectif ?? dernier.tempsSortie) - premier.tempsEntree : 0;
  const anneesSpan = spanMs > 0 ? spanMs / MS_PAR_AN : 0;
  const tradesParAn = anneesSpan > 0 ? nbTrades / anneesSpan : nbTrades;
  const sharpe = sharpeAnnualise(rendements, tradesParAn);

  // Exposition : somme des durées en position / durée totale de la série.
  let sommeDuree = 0;
  for (const t of trades) sommeDuree += t.dureeMs;
  const dureeTotale = candles.length > 0
    ? (finDonneesMs ?? candles[candles.length - 1]?.time ?? 0) - (candles[0]?.time ?? 0)
    : 0;
  const expositionPct = dureeTotale > 0 ? (sommeDuree / dureeTotale) * 100 : 0;

  let sommeR = 0;
  let nbTradesR = 0;
  for (const t of trades) {
    if (t.r !== null && Number.isFinite(t.r)) {
      sommeR += t.r;
      nbTradesR += 1;
    }
  }

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
    nbTradesR,
    sommeR,
    expectancyR: nbTradesR > 0 ? sommeR / nbTradesR : null,
  };
}
