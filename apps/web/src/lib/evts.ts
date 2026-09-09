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
import { formatPct } from "./format";

export interface FenetreAlignee {
  eventTime: number;
  /** Un point par offset −N..+N ; ratio = close(offset)/close(H0), donc ratio(0) = 1. */
  points: { offset: number; ratio: number }[];
}

export interface OccurrenceExclue {
  eventTime: number;
  raison: "fenetre-incomplete" | "fetch-echec" | "h0-absent" | "trou-ohcl";
}

/**
 * Aligne les bougies autour d'un évènement.
 *
 * H0 est uniquement la bougie de l'intervalle réel `[open, open + tfMs)`, et toutes les
 * bougies de `[H0−N, H0+N]` doivent être continues. Une absence ne peut donc jamais
 * décaler H0 vers la dernière bougie précédente.
 */
export function alignerFenetre(
  candles: Candle[],
  eventTime: number,
  demiFenetre: number,
  tfMs?: number,
): FenetreAlignee | OccurrenceExclue {
  const pas = tfMs ?? infererPas(candles);
  if (!Number.isFinite(pas) || pas <= 0) return { eventTime, raison: "h0-absent" };
  const h0 = candles.findIndex((candle) =>
    Number.isFinite(candle.time) && candle.time <= eventTime && eventTime < candle.time + pas,
  );
  if (h0 < 0) return { eventTime, raison: "h0-absent" };
  if (h0 - demiFenetre < 0 || h0 + demiFenetre >= candles.length) {
    return { eventTime, raison: "fenetre-incomplete" };
  }

  for (let index = h0 - demiFenetre; index <= h0 + demiFenetre; index++) {
    const courant = candles[index];
    const precedent = index > h0 - demiFenetre ? candles[index - 1] : undefined;
    if (
      courant === undefined ||
      !Number.isFinite(courant.close) ||
      (precedent !== undefined && courant.time !== precedent.time + pas)
    ) {
      return { eventTime, raison: "trou-ohcl" };
    }
  }

  const base = candles[h0]!.close;
  const points: FenetreAlignee["points"] = [];
  for (let offset = -demiFenetre; offset <= demiFenetre; offset++) {
    points.push({ offset, ratio: candles[h0 + offset]!.close / base });
  }
  return { eventTime, points };
}

export interface ReactionHorizon {
  minutes: 5 | 15 | 60 | 1440;
  /** Nombre de minutes post-annonce effectivement continues. */
  couverture: number;
  rendementPct: number | null;
  /** Volume cumulé des minutes postérieures à H0, dans l'unité de l'exchange. */
  volume: number | null;
  /** Écart-type population des retours minute à minute, en %. */
  volatilitePct: number | null;
}

export interface ReactionEvenement {
  eventTime: number;
  horizons: ReactionHorizon[];
}

const HORIZONS_REACTION = [5, 15, 60, 1440] as const;

/**
 * Mesure une réaction sur des bougies M1 continues. Les données insuffisantes ne sont pas
 * extrapolées : l'occurrence entière est écartée afin qu'une séance partielle ne devienne
 * pas une fausse mesure 24 h.
 */
export function calculerReactionEvenement(
  candles: Candle[],
  eventTime: number,
): ReactionEvenement | OccurrenceExclue {
  const h0 = candles.findIndex((candle) => candle.time <= eventTime && eventTime < candle.time + 60_000);
  if (h0 < 0) return { eventTime, raison: "h0-absent" };
  const segment = candles.slice(h0, h0 + 1441);
  if (segment.length !== 1441) return { eventTime, raison: "trou-ohcl" };
  for (let index = 0; index < segment.length; index++) {
    const courant = segment[index];
    const precedent = segment[index - 1];
    if (
      courant === undefined ||
      !Number.isFinite(courant.close) ||
      !Number.isFinite(courant.volume) ||
      (precedent !== undefined && courant.time !== precedent.time + 60_000)
    ) {
      return { eventTime, raison: "trou-ohcl" };
    }
  }
  const base = segment[0]!.close;
  if (!Number.isFinite(base) || base === 0) return { eventTime, raison: "trou-ohcl" };
  return {
    eventTime,
    horizons: HORIZONS_REACTION.map((minutes) => {
      const fin = segment[minutes]!;
      const post = segment.slice(1, minutes + 1);
      const retours = post.flatMap((candle, index) => {
        const precedent = segment[index]!;
        return precedent.close > 0 && candle.close > 0 ? [candle.close / precedent.close - 1] : [];
      });
      return {
        minutes,
        couverture: minutes,
        rendementPct: (fin.close / base - 1) * 100,
        volume: post.reduce((somme, candle) => somme + candle.volume, 0),
        volatilitePct: ecartTypePopulation(retours) * 100,
      };
    }),
  };
}

/** Pas minimal observé, réservé aux appels historiques ; EVTS transmet toujours son TF. */
function infererPas(candles: Candle[]): number {
  let pas = Infinity;
  for (let i = 1; i < candles.length; i++) {
    const precedent = candles[i - 1];
    const courant = candles[i];
    if (precedent === undefined || courant === undefined) continue;
    const ecart = courant.time - precedent.time;
    if (ecart > 0 && ecart < pas) pas = ecart;
  }
  return pas;
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

// ─────────────────────────── Helpers du composant (purs, testés) ───────────────────────────

/**
 * Les `n` DERNIERS éléments PASSÉS (`time` strictement < `maintenant`), en conservant
 * l'ordre croissant reçu. Générique sur `{ time }` pour rester découplé de la couche data
 * (`DateEvenement` satisfait la contrainte). `n ≤ 0` → `[]` ; `n` > disponible → tous.
 */
export function derniersPasses<T extends { time: number }>(items: T[], maintenant: number, n: number): T[] {
  if (n <= 0) return [];
  return items.filter((it) => it.time < maintenant).slice(-n);
}

/**
 * Paramètres du fetch fenêtré d'UN évènement (pas de pagination massive) : assez de bougies
 * pour couvrir [H0−demiFenetre, H0+demiFenetre] autour de la bougie qui couvre l'évènement.
 *  - `limit = 2·demiFenetre + 10` (le +10 garantit la marge gauche : le fetch remonte
 *    depuis `endTime`) ;
 *  - `endTime = eventTime + (demiFenetre+2)·tfMs` (marge droite au-delà de +demiFenetre).
 * `tfMs` : 1 h = 3 600 000, 1 j = 86 400 000.
 */
export function fenetreFetch(
  eventTime: number,
  demiFenetre: number,
  tfMs: number,
): { limit: number; endTime: number } {
  return { limit: 2 * demiFenetre + 10, endTime: eventTime + (demiFenetre + 2) * tfMs };
}

/**
 * Libellé condensé du retour forward médian (offset +demiFenetre), destiné à la fenêtre
 * BRIEF (Task 4) — ex. « méd +24 h : -0.8% ». Signe explicite + 1 décimale via `formatPct`
 * (conventions lib/format) ; unité selon le TF (« h » pour 1 h, « j » pour 1 j).
 */
export function libelleStatParType(perfMedianePost: number, demiFenetre: number, tf: "1h" | "1d"): string {
  const unite = tf === "1h" ? "h" : "j";
  return `méd +${demiFenetre} ${unite} : ${formatPct(perfMedianePost, 1)}`;
}
