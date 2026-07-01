/**
 * @axiom/alerts — types.ts
 *
 * Contrat de données du moteur d'alertes. Volontairement DÉCOUPLÉ de la couche
 * app (aucun import React / DOM / store) pour que le même moteur soit réutilisé
 * tel quel par le futur daemon de Phase 2 (roadmap 03, piste 1.7).
 *
 * Une `AlertDef` porte : sa cible (symbol + source), sa `condition` (union
 * discriminée), un `message` optionnel, l'état `actif`, l'état de ré-armement
 * `arme` (géré par le moteur, cf. engine.ts) et le journal `declenchements`
 * (horodatages ms epoch, borné).
 */

import type { Candle, ExchangeId } from "@axiom/types";

/** Sens d'un franchissement / croisement. */
export type SensCroisement = "hausse" | "baisse" | "les-deux";

/** Comparateur d'un seuil d'indicateur. */
export type Comparateur = ">" | ">=" | "<" | "<=";

/** Franchissement d'un niveau de prix (support/résistance). */
export interface ConditionPrixCroise {
  type: "prix-croise";
  /** Niveau de prix surveillé. */
  niveau: number;
  /** Sens surveillé du franchissement. */
  sens: SensCroisement;
}

/**
 * Variation en pourcentage sur une fenêtre glissante `fenetreMs`.
 * `seuilPct` est SIGNÉ : > 0 déclenche à la hausse, < 0 à la baisse
 * (ex. -5 = « chute de 5 % ou plus sur la fenêtre »).
 */
export interface ConditionVariationPct {
  type: "variation-pct";
  fenetreMs: number;
  seuilPct: number;
}

/** Seuil sur une sortie d'indicateur (ex. RSI > 70). */
export interface ConditionIndicateurSeuil {
  type: "indicateur-seuil";
  /** Id d'indicateur dans @axiom/indicators (cf. registry). */
  indicateurId: string;
  /** Surcharges de paramètres passées au calcul (vides = valeurs par défaut). */
  params: Record<string, number | boolean | string>;
  /** Clé de la série de sortie évaluée (ex. "rsi"). */
  output: string;
  comparateur: Comparateur;
  valeur: number;
}

/**
 * Croisement entre DEUX sorties d'un même indicateur (ex. MACD `macd` × `signal`).
 * Détecté sur les deux dernières valeurs définies des séries.
 */
export interface ConditionIndicateurCroisement {
  type: "indicateur-croisement";
  indicateurId: string;
  params: Record<string, number | boolean | string>;
  /** Sortie A (celle qui « croise »). */
  outputA: string;
  /** Sortie B (référence croisée). */
  outputB: string;
  sens: SensCroisement;
}

/** Condition d'une alerte (union discriminée sur `type`). */
export type Condition =
  | ConditionPrixCroise
  | ConditionVariationPct
  | ConditionIndicateurSeuil
  | ConditionIndicateurCroisement;

/** Définition d'une alerte. */
export interface AlertDef {
  id: string;
  symbol: string;
  source: ExchangeId;
  condition: Condition;
  /** Message personnalisé ; à défaut le moteur en dérive un via `decrireCondition`. */
  message?: string;
  actif: boolean;
  /**
   * État de ré-armement, géré PAR LE MOTEUR (opaque à l'UI) :
   *  - `undefined` : jamais évaluée → la première évaluation CALIBRE le côté courant
   *    sans déclencher (évite un déclenchement immédiat sur une condition déjà vraie) ;
   *  - `true`  : armée (prête à déclencher au prochain franchissement) ;
   *  - `false` : déjà déclenchée, attend un re-franchissement inverse pour se ré-armer.
   */
  arme?: boolean;
  /** Horodatages (ms epoch) des déclenchements passés, bornés (plus récent en fin). */
  declenchements: number[];
}

/**
 * Contexte d'évaluation d'UN symbole. L'appelant filtre en amont les `defs` du
 * symbole concerné (le moteur ne reçoit pas le symbole — cf. évaluation par lot).
 */
export interface ContexteAlerte {
  /** Instant de l'évaluation (ms epoch) — injecté pour garder le moteur PUR (pas de Date.now interne). */
  maintenant: number;
  /** Dernier prix connu du symbole. */
  dernierPrix: number;
  /** Prix au tick précédent — requis pour un franchissement bidirectionnel (`les-deux`). */
  prixPrecedent?: number;
  /** Bougies du symbole — requises pour `variation-pct` et les conditions d'indicateur. */
  candles?: Candle[];
}

/** Un déclenchement produit par le moteur. */
export interface Declenchement {
  alertId: string;
  /** ms epoch du déclenchement (= `contexte.maintenant`). */
  ts: number;
  /** Valeur ayant déclenché (prix, %, ou valeur d'indicateur selon la condition). */
  valeur: number;
  /** Message résolu (message de la def, sinon description auto de la condition). */
  message: string;
}

/** Résultat d'une passe d'évaluation. */
export interface ResultatEvaluation {
  /** Déclenchements de cette passe (à notifier / journaliser par l'appelant). */
  declenchements: Declenchement[];
  /**
   * `defs` transformées, MÊME ORDRE que l'entrée. Les defs INCHANGÉES conservent
   * leur référence d'origine (permet à l'appelant d'éviter une écriture inutile).
   */
  defs: AlertDef[];
  /** true si au moins une def a changé (déclenchement ou ré-armement). */
  modifie: boolean;
}
