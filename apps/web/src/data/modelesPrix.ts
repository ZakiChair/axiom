/**
 * Modèles de prix de long terme du Bitcoin — calculs PURS, séparés de l'I/O.
 *
 * Trois lectures des mêmes prix quotidiens PriceUSD Coin Metrics (00:00 UTC) :
 * - multiple 200 semaines : prix / SMA 1 400 j. Proxy quotidien de la moyenne des 200
 *   clôtures hebdomadaires : une seule définition pour la valeur, le percentile et la séquence
 *   (1,1791 contre 1,1780 pour la vraie WMA des dimanches au 2026-09-13) ;
 * - prix / SMA 730 j (moyenne 2 ans), sans la bande 5× (jamais franchie depuis 2018) ;
 * - Pi Cycle Bottom : EMA 150 j comparée à 0,745 × SMA 471 j. Le coefficient a été calé a
 *   posteriori sur les planchers passés : trois signaux seulement.
 *
 * Ce sont des repères de zone, sans valeur prédictive. Les prix non finis ou ≤ 0 sont ignorés ;
 * la série Coin Metrics est continue, donc N points ≈ N jours. Une absence donne `null`
 * (l'UI affiche « — »), jamais 0.
 */
import { ema, sma } from "@axiom/indicators";
import { rangPercentile } from "../lib/referentiel";
import type { PointMetrique } from "./onchain/coinmetrics";

/** Fenêtre de la SMA quotidienne servant de proxy à la moyenne 200 semaines. */
export const JOURS_200_SEMAINES = 1400;
/** Fenêtre de la moyenne mobile 2 ans. */
export const JOURS_2_ANS = 730;
/** Paramètres du Pi Cycle Bottom : EMA 150 j contre 0,745 × SMA 471 j. */
export const PI_EMA_JOURS = 150;
export const PI_SMA_JOURS = 471;
export const PI_COEFFICIENT = 0.745;

/** Séquence en cours : nombre de points consécutifs du même côté de la moyenne (dessous = ratio < 1). */
export interface SequenceRatio {
  sens: "dessus" | "dessous";
  jours: number;
  /** Date du premier point de la séquence. */
  depuisMs: number;
}

/** Rapport du dernier prix à sa moyenne mobile simple. */
export interface RatioMoyenne {
  ratio: number;
  moyenne: number;
  /** Rang percentile (mi-distance) du dernier ratio dans tout son historique ; NaN si un seul ratio. */
  percentile: number;
  /** Date du premier ratio calculable (début de l'historique du percentile). */
  premierMs: number;
  sequence: SequenceRatio;
}

/** Passage de l'EMA 150 j sous le seuil : entrée au premier jour sous 1, sortie au retour ≥ 1. */
export interface EpisodePiCycle {
  entreeMs: number;
  prixEntree: number;
  /** null tant que l'épisode est en cours. */
  sortieMs: number | null;
}

export interface PiCycleBottom {
  /** EMA 150 j / (0,745 × SMA 471 j) : sous 1 = signal. */
  ratio: number;
  /** Écart au croisement, en % (ratio − 1). */
  ecartPct: number;
  ema150: number;
  /** 0,745 × SMA 471 j. */
  seuil: number;
  episodes: EpisodePiCycle[];
}

export interface ModelesPrix {
  multiple200Semaines: RatioMoyenne | null;
  ratio2Ans: RatioMoyenne | null;
  piCycleBottom: PiCycleBottom | null;
}

/** Prix exploitables (finis et > 0), dans l'ordre de la série. */
function prixValides(points: readonly PointMetrique[]): PointMetrique[] {
  return points.filter((p) => Number.isFinite(p.value) && p.value > 0);
}

/**
 * Prix / SMA(`fenetre`) au dernier point. Percentile du dernier ratio dans tous les ratios
 * calculables (rang mi-distance, dernier inclus) ; séquence comptée à rebours tant que le ratio
 * reste du même côté de 1. null sous `fenetre` prix exploitables.
 */
export function ratioMoyenne(points: readonly PointMetrique[], fenetre: number): RatioMoyenne | null {
  const valides = prixValides(points);
  if (valides.length < fenetre) return null;
  const moyennes = sma(valides.map((p) => p.value), fenetre);

  const ratios: number[] = [];
  for (let i = fenetre - 1; i < valides.length; i += 1) ratios.push(valides[i]!.value / moyennes[i]!);
  const ratio = ratios[ratios.length - 1]!;

  const dessous = ratio < 1;
  let debut = ratios.length - 1;
  while (debut > 0 && (ratios[debut - 1]! < 1) === dessous) debut -= 1;

  return {
    ratio,
    moyenne: moyennes[valides.length - 1]!,
    percentile: rangPercentile(ratios, ratio),
    premierMs: valides[fenetre - 1]!.time,
    sequence: {
      sens: dessous ? "dessous" : "dessus",
      jours: ratios.length - debut,
      depuisMs: valides[fenetre - 1 + debut]!.time,
    },
  };
}

/**
 * Pi Cycle Bottom au dernier point, et épisodes historiques : entrée quand le ratio passe de
 * ≥ 1 à < 1 (point précédent requis), sortie au premier retour ≥ 1. Aucun regroupement des
 * croisements. null sous 471 prix exploitables.
 */
export function piCycleBottom(points: readonly PointMetrique[]): PiCycleBottom | null {
  const valides = prixValides(points);
  if (valides.length < PI_SMA_JOURS) return null;
  const valeurs = valides.map((p) => p.value);
  const emas = ema(valeurs, PI_EMA_JOURS);
  const smas = sma(valeurs, PI_SMA_JOURS);

  const episodes: EpisodePiCycle[] = [];
  let precedent: number | null = null;
  let ratio = Number.NaN;
  for (let i = PI_SMA_JOURS - 1; i < valides.length; i += 1) {
    ratio = emas[i]! / (PI_COEFFICIENT * smas[i]!);
    if (precedent !== null && precedent >= 1 && ratio < 1) {
      episodes.push({ entreeMs: valides[i]!.time, prixEntree: valeurs[i]!, sortieMs: null });
    } else if (precedent !== null && precedent < 1 && ratio >= 1 && episodes.length > 0) {
      const dernier = episodes[episodes.length - 1]!;
      if (dernier.sortieMs === null) dernier.sortieMs = valides[i]!.time;
    }
    precedent = ratio;
  }

  const n = valides.length - 1;
  return {
    ratio,
    ecartPct: (ratio - 1) * 100,
    ema150: emas[n]!,
    seuil: PI_COEFFICIENT * smas[n]!,
    episodes,
  };
}

/** Les trois modèles sur le même historique (calculés une fois par run, jamais au rendu). */
export function calculerModelesPrix(points: readonly PointMetrique[]): ModelesPrix {
  return {
    multiple200Semaines: ratioMoyenne(points, JOURS_200_SEMAINES),
    ratio2Ans: ratioMoyenne(points, JOURS_2_ANS),
    piCycleBottom: piCycleBottom(points),
  };
}
