/**
 * @axiom/backtest — types.ts
 *
 * Contrat de données du moteur de backtest. Volontairement DÉCOUPLÉ de la couche app
 * (aucun import React / DOM / store) : le moteur est PUR et pourrait tourner tel quel
 * côté daemon.
 *
 * Le vocabulaire de conditions REPREND celui de @axiom/alerts et du screener
 * (comparaison / croisement sur des sorties de @axiom/indicators + prix/volume) — ce
 * n'est PAS un langage de script (anti-objectif « Pine-like », cf. BUILD-CONTRACT).
 * La seule généralisation est l'`Operande` : au lieu de figer « sortie d'indicateur vs
 * constante », les deux côtés d'une condition sont des opérandes composables
 * (prix, constante, ou sortie d'indicateur), ce qui rend les règles réellement
 * composables sans introduire d'expressions arbitraires.
 */

/** Comparateur numérique (identique au screener/alerts). */
export type Comparateur = ">" | ">=" | "<" | "<=";

/** Sens d'un croisement d'opérandes (montant / descendant). */
export type SensCroisement = "hausse" | "baisse";

/**
 * Sens autorisé des positions ouvertes par la stratégie :
 *  - "long"     : `reglesEntree` ouvre une position LONGUE, `reglesSortie` la ferme ;
 *  - "short"    : `reglesEntree` ouvre une position COURTE, `reglesSortie` la ferme ;
 *  - "les-deux" : système à retournement — `reglesEntree` = signal LONG, `reglesSortie`
 *    = signal SHORT. À plat, le premier signal vrai ouvre la position correspondante ;
 *    une position longue se ferme sur signal short (ou stop/target), une courte sur
 *    signal long (ou stop/target). Le retournement n'est jamais instantané : la clôture
 *    ramène à plat, la réouverture inverse a lieu à une barre ULTÉRIEURE (au plus tôt la
 *    suivante), ce qui préserve l'invariant « une position à la fois » sans look-ahead.
 */
export type Direction = "long" | "short" | "les-deux";

/** Champ OHLCV lu sur une bougie. */
export type ChampPrix = "open" | "high" | "low" | "close" | "volume";

/** Opérande « prix » : lit un champ OHLCV de la bougie courante. */
export interface OperandePrix {
  type: "prix";
  champ: ChampPrix;
}

/** Opérande « constante » : une valeur numérique fixe. */
export interface OperandeConstante {
  type: "constante";
  valeur: number;
}

/** Opérande « indicateur » : une sortie d'un `IndicatorDef` de @axiom/indicators. */
export interface OperandeIndicateur {
  type: "indicateur";
  /** Id du def dans @axiom/indicators (ex. "rsi", "ema", "macd"). */
  indicateurId: string;
  /** Surcharges de paramètres passées au calcul (vides = valeurs par défaut). */
  params: Record<string, number | boolean | string>;
  /** Clé de la série de sortie lue (ex. "rsi", "ema", "macd", "signal"). */
  output: string;
}

/** Un opérande composable (union discriminée sur `type`). */
export type Operande = OperandePrix | OperandeConstante | OperandeIndicateur;

/** Comparaison de deux opérandes à la clôture de la bougie (ex. RSI < 30, close > EMA). */
export interface ConditionComparaison {
  type: "comparaison";
  gauche: Operande;
  comparateur: Comparateur;
  droite: Operande;
}

/**
 * Croisement de deux opérandes, détecté sur les DEUX dernières bougies clôturées
 * (ex. EMA rapide croise EMA lente à la hausse, close croise un niveau).
 */
export interface ConditionCroisement {
  type: "croisement";
  a: Operande;
  b: Operande;
  sens: SensCroisement;
}

/** Une condition de règle (union discriminée sur `type`). */
export type Condition = ConditionComparaison | ConditionCroisement;

/**
 * Définition d'une stratégie. Les règles sont des LISTES conjonctives (ET) : toutes les
 * conditions d'une liste doivent être vraies. Une liste VIDE ne déclenche jamais (ni
 * entrée fantôme, ni sortie automatique).
 */
export interface StrategieDef {
  reglesEntree: Condition[];
  reglesSortie: Condition[];
  /** Stop en % du prix d'entrée (évalué sur la CLÔTURE, sans intrabar). Omis = pas de stop. */
  stopPct?: number;
  /** Objectif en % du prix d'entrée (évalué sur la CLÔTURE, sans intrabar). Omis = pas d'objectif. */
  targetPct?: number;
  direction: Direction;
  /** Taille fixe par position, en NOTIONNEL de cotation (ex. 1000 = 1000 USDT engagés). */
  tailleFixe: number;
}

/** Paramètres d'exécution (frais / slippage / capital), indépendants de la stratégie. */
export interface ParamsBacktest {
  /** Frais par côté (entrée ET sortie), en % du notionnel. */
  fraisPct: number;
  /** Slippage par côté, en % (dégrade le prix de fill). */
  slippagePct: number;
  /** Capital initial (base de l'equity curve, du drawdown et du rendement total). */
  capitalInitial: number;
}

/** Sens effectif d'une position ouverte. */
export type SensPosition = "long" | "short";

/**
 * Raison de clôture d'un trade :
 *  - "regle"       : `reglesSortie` (ou signal inverse en mode les-deux) satisfait ;
 *  - "stop"        : stop touché à la clôture ;
 *  - "target"      : objectif touché à la clôture ;
 *  - "fin-donnees" : position encore ouverte à la fin de la série (marquée au dernier close).
 */
export type RaisonSortie = "regle" | "stop" | "target" | "fin-donnees";

/** Un trade clôturé (prix de fill = slippage inclus ; pnl = net de frais). */
export interface TradeResultat {
  sens: SensPosition;
  /** ms epoch de l'OPEN de la bougie de fill d'entrée. */
  tempsEntree: number;
  /** Prix de fill d'entrée (slippage appliqué). */
  prixEntree: number;
  /** ms epoch de l'OPEN de la bougie de fill de sortie (ou de la dernière bougie). */
  tempsSortie: number;
  /** Prix de fill de sortie (slippage appliqué). */
  prixSortie: number;
  raison: RaisonSortie;
  /** Quantité en base (tailleFixe / prixEntree). */
  quantite: number;
  /** PnL net (frais + slippage inclus), en cotation. */
  pnl: number;
  /** PnL net rapporté à la taille engagée (pnl / tailleFixe · 100). */
  pnlPct: number;
  /** Frais totaux des deux côtés, en cotation. */
  frais: number;
  /** Durée en nombre de bougies (index de sortie − index d'entrée). */
  dureeBarres: number;
  /** Durée en ms (tempsSortie − tempsEntree). */
  dureeMs: number;
}

/** Un point de l'equity curve (après chaque trade, plus un point initial). */
export interface PointEquity {
  /** ms epoch (temps de sortie du trade ; temps de la 1re bougie pour le point initial). */
  temps: number;
  /** Capital cumulé (capitalInitial + somme des pnl jusqu'ici). */
  equity: number;
  /** Drawdown à ce point, en % du plus haut atteint. */
  drawdownPct: number;
}

/** Statistiques agrégées d'un backtest. */
export interface StatsBacktest {
  nbTrades: number;
  nbGagnants: number;
  nbPerdants: number;
  /** Taux de réussite en % (gagnants / total). */
  winRatePct: number;
  /** Profit factor = Σ gains / Σ |pertes|. Infinity si aucune perte, 0 si aucun gain. */
  profitFactor: number;
  /** PnL net total, en cotation. */
  pnlTotal: number;
  /** PnL net total en % du capital initial. */
  pnlTotalPct: number;
  /** Drawdown maximum en % (plus grande chute pic → creux de l'equity). */
  maxDrawdownPct: number;
  /** Sharpe simple annualisé depuis les rendements par trade (cf. engine.ts). */
  sharpe: number;
  /** Exposition = fraction du temps en position, en % de la durée totale de la série. */
  expositionPct: number;
  /** Gain moyen des trades gagnants, en % (0 si aucun). */
  gainMoyenPct: number;
  /** Perte moyenne des trades perdants, en % (valeur négative ; 0 si aucun). */
  perteMoyennePct: number;
}

/** Résultat complet d'un backtest. */
export interface ResultatBacktest {
  trades: TradeResultat[];
  equity: PointEquity[];
  stats: StatsBacktest;
  /** Nombre de bougies (clôturées) effectivement testées. */
  nbBougies: number;
}
