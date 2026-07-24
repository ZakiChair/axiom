/**
 * Calculs purs d'alignement pour l'étude d'évènements (EVTS).
 *
 * Aligne la performance du prix autour d'occurrences d'évènements macro (CPI/NFP/FOMC),
 * en base 100 par rapport à la bougie qui couvre l'évènement (H0), puis agrège les
 * fenêtres (médiane + bande p25–p75) et résume quelques statistiques.
 *
 * Aucun accès React/DOM/réseau : fonctions pures et déterministes, testées à côté
 * (evts.test.ts). Patron : lib/seasonality.ts.
 *
 * CONVENTIONS D'UNITÉ (contrat pour le composant EvtsWindow) :
 *   - `alignerFenetre`/`agregerFenetres` renvoient des RATIOS bruts (H0 = 1, base 100
 *     s'obtient en ×100) — l'axe du graphe se dessine directement dessus.
 *   - `statsEvts` renvoie des POURCENTAGES (déjà ×100) prêts à afficher.
 */
import type { Candle } from "@axiom/types";

export interface FenetreAlignee {
  eventTime: number;
  /** Un point par offset −N..+N ; ratio = close(offset)/close(H0), donc ratio(0) = 1. */
  points: { offset: number; ratio: number }[];
}

export interface OccurrenceExclue {
  eventTime: number;
  raison: "fenetre-incomplete" | "fetch-echec";
}

/**
 * Aligne les bougies autour d'un évènement.
 *
 * H0 = dernière bougie dont l'open time ≤ eventTime (la bougie qui COUVRE l'évènement) ;
 * l'alignement suit les INDEX (pas le temps), donc un trou entre bougies décale H0 mais
 * la fenêtre reste [i−N, i+N]. Si aucune bougie ne couvre l'évènement ou si la fenêtre
 * déborde des bornes disponibles, l'occurrence est exclue (`fenetre-incomplete`).
 */
export function alignerFenetre(
  candles: Candle[],
  eventTime: number,
  demiFenetre: number,
): FenetreAlignee | OccurrenceExclue {
  // Dernière bougie ≤ eventTime (candles supposées triées par temps croissant).
  let h0 = -1;
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    if (candle !== undefined && candle.time <= eventTime) h0 = i;
  }
  if (h0 < 0 || h0 - demiFenetre < 0 || h0 + demiFenetre >= candles.length) {
    return { eventTime, raison: "fenetre-incomplete" };
  }

  const base = candles[h0]!.close;
  const points: FenetreAlignee["points"] = [];
  for (let offset = -demiFenetre; offset <= demiFenetre; offset++) {
    points.push({ offset, ratio: candles[h0 + offset]!.close / base });
  }
  return { eventTime, points };
}

export interface AgregatEvts {
  offsets: number[];
  mediane: number[];
  p25: number[];
  p75: number[];
}

/**
 * Agrège les fenêtres alignées point à point : pour chaque offset présent, médiane et
 * quantiles p25/p75 des ratios (interpolation linéaire, cf. `percentile`).
 */
export function agregerFenetres(fenetres: FenetreAlignee[]): AgregatEvts {
  const parOffset = new Map<number, number[]>();
  for (const fenetre of fenetres) {
    for (const point of fenetre.points) {
      const valeurs = parOffset.get(point.offset) ?? [];
      valeurs.push(point.ratio);
      parOffset.set(point.offset, valeurs);
    }
  }

  const offsets = [...parOffset.keys()].sort((a, b) => a - b);
  const mediane: number[] = [];
  const p25: number[] = [];
  const p75: number[] = [];
  for (const offset of offsets) {
    const triAsc = [...(parOffset.get(offset) ?? [])].sort((a, b) => a - b);
    mediane.push(percentile(triAsc, 0.5));
    p25.push(percentile(triAsc, 0.25));
    p75.push(percentile(triAsc, 0.75));
  }
  return { offsets, mediane, p25, p75 };
}

export interface StatsEvts {
  /** Niveau médian base-100 au bord gauche (offset −N), en % : (méd. ratio(−N) − 1) × 100. */
  perfMedianePre: number;
  /** Niveau médian base-100 au bord droit (offset +N), en % : (méd. ratio(+N) − 1) × 100. */
  perfMedianePost: number;
  /** Écart-type de POPULATION (÷n) des retours barre à barre de la moitié post (offsets ≥ 0), en %. */
  volPost: number;
  /** Extrême bas sur tous les points de toutes les fenêtres, en % : (min ratio − 1) × 100. */
  min: number;
  /** Extrême haut sur tous les points de toutes les fenêtres, en % : (max ratio − 1) × 100. */
  max: number;
}

/**
 * Résumé statistique de l'échantillon de fenêtres.
 *
 * Les médianes pré/post réutilisent la même convention `percentile` que l'agrégat, si bien
 * que `perfMedianePre/Post` coïncident avec les extrémités de la médiane tracée (honnêteté
 * d'échantillon). Toutes les valeurs sont en POURCENTAGES.
 */
export function statsEvts(fenetres: FenetreAlignee[]): StatsEvts {
  const ratiosPre: number[] = [];
  const ratiosPost: number[] = [];
  const retoursBarrePost: number[] = [];
  let minRatio = Infinity;
  let maxRatio = -Infinity;

  for (const fenetre of fenetres) {
    if (fenetre.points.length === 0) continue;

    let ptGauche = fenetre.points[0]!;
    let ptDroit = fenetre.points[0]!;
    for (const point of fenetre.points) {
      if (point.offset < ptGauche.offset) ptGauche = point;
      if (point.offset > ptDroit.offset) ptDroit = point;
      if (point.ratio < minRatio) minRatio = point.ratio;
      if (point.ratio > maxRatio) maxRatio = point.ratio;
    }
    ratiosPre.push(ptGauche.ratio);
    ratiosPost.push(ptDroit.ratio);

    // Retours barre à barre sur la moitié post (offsets ≥ 0).
    const post = fenetre.points
      .filter((point) => point.offset >= 0)
      .sort((a, b) => a.offset - b.offset);
    for (let i = 1; i < post.length; i++) {
      const precedent = post[i - 1]!;
      const courant = post[i]!;
      if (precedent.ratio !== 0) retoursBarrePost.push(courant.ratio / precedent.ratio - 1);
    }
  }

  if (ratiosPre.length === 0) {
    return { perfMedianePre: 0, perfMedianePost: 0, volPost: 0, min: 0, max: 0 };
  }

  const preTri = [...ratiosPre].sort((a, b) => a - b);
  const postTri = [...ratiosPost].sort((a, b) => a - b);
  return {
    perfMedianePre: (percentile(preTri, 0.5) - 1) * 100,
    perfMedianePost: (percentile(postTri, 0.5) - 1) * 100,
    volPost: ecartTypePopulation(retoursBarrePost) * 100,
    min: (minRatio - 1) * 100,
    max: (maxRatio - 1) * 100,
  };
}

/** Percentile par interpolation linéaire sur tableau trié — MÊME convention que SeasonalityWindow. */
function percentile(triAsc: number[], p: number): number {
  if (triAsc.length === 0) return 0;
  const pos = (triAsc.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = triAsc[lo] ?? 0;
  const b = triAsc[hi] ?? a;
  return a + (b - a) * (pos - lo);
}

/** Écart-type de population (÷n) ; tableau vide → 0. */
function ecartTypePopulation(valeurs: number[]): number {
  if (valeurs.length === 0) return 0;
  const moyenne = valeurs.reduce((acc, v) => acc + v, 0) / valeurs.length;
  const variance = valeurs.reduce((acc, v) => acc + (v - moyenne) ** 2, 0) / valeurs.length;
  return Math.sqrt(variance);
}
