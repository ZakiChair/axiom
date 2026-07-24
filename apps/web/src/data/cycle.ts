/**
 * Cycle de 4 ans du Bitcoin (halving) — calculs PURS, séparés de l'I/O.
 *
 * On aligne les cycles passés et le cycle courant sur le JOUR 0 = date du halving, puis
 * on exprime le prix en INDICE relatif (prix / prix au jour du halving). Superposés en
 * échelle log, les 4 cycles deviennent comparables (l'ampleur des mouvements, pas leur
 * niveau absolu). Le cycle courant s'arrête naturellement à la dernière donnée ; chaque
 * cycle passé est borné au HALVING SUIVANT (les cycles réels durent 1319/1402/1440 j,
 * moins que la fenêtre max 1500 j : sans cette borne, le début du cycle suivant —
 * ex. l'ATH pré-halving de mars 2024 — contaminerait le sommet du cycle précédent).
 *
 * ⚠️ Aucun cycle passé ne préjuge du courant — l'histoire n'est qu'un repère, pas un modèle.
 * Fonctions NaN-safe : les entrées non finies sont ignorées (l'UI affiche « — »).
 */
import type { PointMetrique } from "./onchain/coinmetrics";

/** Un jour en millisecondes (les points Coin Metrics PriceUSD sont datés à 00:00 UTC). */
const JOUR_MS = 86_400_000;

/** Fenêtre d'observation d'un cycle passé (jours post-halving) — ~un cycle complet. */
export const FENETRE_JOURS = 1500;

/**
 * Dates des 4 halvings Bitcoin en UTC (ms epoch). Constantes historiques :
 * 2012-11-28, 2016-07-09, 2020-05-11, 2024-04-20. Ordre chronologique.
 */
export const HALVINGS: readonly number[] = [
  Date.UTC(2012, 10, 28),
  Date.UTC(2016, 6, 9),
  Date.UTC(2020, 4, 11),
  Date.UTC(2024, 3, 20),
];

/** Un point d'un cycle aligné : `jour` post-halving et `indice` = prix / prix au jour 0. */
export interface PointCycle {
  jour: number;
  indice: number;
}

/** Série d'un cycle : son rang de halving (1..4), la date du halving (ms) et ses points. */
export interface SerieCycle {
  /** Rang du halving : 1 = 2012, 2 = 2016, 3 = 2020, 4 = 2024 (cycle courant). */
  halvingIndex: number;
  /** Date du halving en ms epoch (UTC). */
  halvingMs: number;
  /** Points alignés (jour 0 = halving), triés par jour croissant, bornés au halving
   *  suivant (cycles passés) et à la fenêtre max 0..1500 j. */
  points: PointCycle[];
}

/** Statistiques d'un cycle : sommet, état courant et repli depuis le sommet. */
export interface StatsCycle {
  /** Indice au sommet du cycle (×multiple max vs prix au halving). */
  topIndice: number;
  /** Jour post-halving du sommet. */
  topJour: number;
  /** Repli du dernier point vs sommet, en % (≤ 0). */
  drawdownDepuisTopPct: number;
  /** Indice au dernier point observé. */
  indiceCourant: number;
  /** Jour post-halving du dernier point observé. */
  jourCourant: number;
}

/**
 * Découpe une série de prix quotidiens en un cycle par halving. PURE.
 *
 * Pour chaque halving : `base` = prix du premier point de jour ≥ 0 (le jour 0 exact s'il
 * existe, sinon le plus proche après le halving) ; `indice = prix / base` (donc 1 au jour
 * de base) ; fenêtre retenue 0..min(1500, veille du halving suivant) — un cycle passé
 * s'arrête STRICTEMENT avant son successeur, sinon son sommet serait contaminé par le
 * début du cycle suivant. Un halving sans point exploitable (aucune donnée après lui,
 * ou base non finie / ≤ 0) ne produit PAS de série.
 *
 * La troncature du cycle courant « à aujourd'hui » découle du filtre sans horloge
 * injectée : les données du cycle courant s'arrêtent d'elles-mêmes au dernier point.
 */
export function decouperCycles(points: readonly PointMetrique[]): SerieCycle[] {
  // Copie triée chronologiquement (défensif : on ne suppose pas l'ordre d'entrée).
  const tries = [...points].sort((a, b) => a.time - b.time);
  const series: SerieCycle[] = [];

  for (let i = 0; i < HALVINGS.length; i += 1) {
    const halvingMs = HALVINGS[i]!;
    // Borne haute du cycle : veille du halving suivant s'il existe, sinon fenêtre max.
    const suivantMs = HALVINGS[i + 1];
    const finJours =
      suivantMs !== undefined
        ? Math.min(FENETRE_JOURS, Math.round((suivantMs - halvingMs) / JOUR_MS) - 1)
        : FENETRE_JOURS;
    // Points du cycle : jour post-halving dans la fenêtre 0..finJours, prix fini.
    const bruts: PointCycle[] = [];
    for (const p of tries) {
      if (!Number.isFinite(p.time) || !Number.isFinite(p.value)) continue;
      const jour = Math.round((p.time - halvingMs) / JOUR_MS);
      if (jour < 0 || jour > finJours) continue;
      bruts.push({ jour, indice: p.value }); // `indice` porte le prix brut avant normalisation
    }
    if (bruts.length === 0) continue;

    // Base = prix du premier point de jour ≥ 0 (bruts est déjà trié par jour croissant).
    const base = bruts[0]!.indice;
    if (!Number.isFinite(base) || base <= 0) continue;

    const pointsCycle = bruts.map((p) => ({ jour: p.jour, indice: p.indice / base }));
    series.push({ halvingIndex: i + 1, halvingMs, points: pointsCycle });
  }

  return series;
}

/**
 * Statistiques d'un cycle : sommet (indice/jour), état courant (dernier point) et repli
 * depuis le sommet en %. PURE et NaN-safe : une série vide renvoie des NaN (l'UI affiche « — »).
 */
export function statsCycle(serie: readonly PointCycle[]): StatsCycle {
  if (serie.length === 0) {
    return {
      topIndice: NaN,
      topJour: NaN,
      drawdownDepuisTopPct: NaN,
      indiceCourant: NaN,
      jourCourant: NaN,
    };
  }

  let topIndice = -Infinity;
  let topJour = NaN;
  for (const p of serie) {
    if (Number.isFinite(p.indice) && p.indice > topIndice) {
      topIndice = p.indice;
      topJour = p.jour;
    }
  }

  const dernier = serie[serie.length - 1]!;
  const indiceCourant = dernier.indice;
  const jourCourant = dernier.jour;
  const drawdownDepuisTopPct =
    Number.isFinite(topIndice) && topIndice > 0 && Number.isFinite(indiceCourant)
      ? (indiceCourant / topIndice - 1) * 100
      : NaN;

  return { topIndice, topJour, drawdownDepuisTopPct, indiceCourant, jourCourant };
}

/**
 * Mayer Multiple : dernier prix / moyenne mobile 200 jours. PURE.
 * Renvoie `null` si moins de 200 points, ou si le dernier prix / la MM200 n'est pas finie.
 */
export function mayerMultiple(points: readonly PointMetrique[]): number | null {
  if (points.length < 200) return null;

  const dernier = points[points.length - 1]!;
  if (!Number.isFinite(dernier.value)) return null;

  // Moyenne des 200 derniers prix finis (la fenêtre est censée être continue en daily).
  let somme = 0;
  let n = 0;
  for (let i = points.length - 200; i < points.length; i += 1) {
    const v = points[i]!.value;
    if (!Number.isFinite(v)) continue;
    somme += v;
    n += 1;
  }
  if (n === 0) return null;
  const mm200 = somme / n;
  if (!Number.isFinite(mm200) || mm200 <= 0) return null;

  return dernier.value / mm200;
}
