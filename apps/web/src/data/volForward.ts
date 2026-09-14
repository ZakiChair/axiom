/**
 * Vol forward entre échéances consécutives et move implicite d'événement (fonctions PURES) —
 * barres et colonne de la vue Term IV d'OMON.
 *
 * POURQUOI : l'IV ATM d'une échéance mélange toute la variance jusqu'à elle. L'additivité de la
 * variance totale (σ²T) isole ce que le marché paie ENTRE deux échéances :
 *   σ_fwd² = (σ2²·T2 − σ1²·T1) / (T2 − T1), σ = IV ATM de la courbe (convention termIv.ts).
 * Un pic localisé sur une fenêtre qui contient une publication (FOMC, CPI…) chiffre la prime
 * d'événement : part attribuable ≈ √(σ_fwd² − σ_base²) × √Δt, σ_base = médiane des σ_fwd des
 * fenêtres courtes voisines sans événement.
 *
 * LIMITES : IV mark des quotidiennes peu adossée à l'OI (±2,5 à 3 pts sur σ_fwd, amplifiés
 * quand Δt = 1 j) ; variance calendaire (week-ends inclus) ; prime de variance incluse. Variance
 * forward négative = surface incohérente, σ_fwd null (jamais 0). Fenêtre dont l'échéance de
 * début a moins de 12 h masquée (lecture instable). La part d'événement n'est lue que sur les
 * fenêtres de 7 j au plus : au-delà, l'excès de variance mêle la pente de la courbe. Fenêtre
 * finissant après la couverture du calendrier ECO chargé (dernier événement daté par ForexFactory
 * ou FRED ; les dates FOMC statiques vont plus loin mais seules) : « calendrier non couvert »,
 * absence d'événement non vérifiée, donc ni part d'événement ni place dans σ_base.
 *
 * ZÉRO fetch : consomme les points de `termStructureIv` et les événements ECO déjà en mémoire ;
 * `nowMs` injecté par l'appelant. Module PARESSEUX : importé seulement par OptionsWindow.
 */

import type { EcoEvent } from "./eco";

const MS_PAR_JOUR = 24 * 60 * 60 * 1000;
/** Base 365 j (convention du dépôt, cf. skew.ts). */
const JOURS_PAR_AN = 365;
/** Fenêtre masquée si l'échéance de début a moins de 12 h de vie. */
export const SEUIL_MASQUE_MS = 12 * 3_600_000;
/** Fenêtres admises dans σ_base et seules lues pour la part d'événement (zone des hebdomadaires). */
export const DT_BASE_MAX_JOURS = 7;

export interface EvenementVol {
  time: number;
  libelle: string;
}

export interface SegmentVolForward {
  debutMs: number;
  finMs: number;
  dtJours: number;
  /** √[(σ2²T2 − σ1²T1)/(T2 − T1)] en % ; null si masqué ou variance ≤ 0. */
  sigmaFwd: number | null;
  varianceNegative: boolean;
  masque: boolean;
  /** sigmaFwd × √(dt/365), en % (move 1σ sur la fenêtre). */
  move1SigmaPct: number | null;
  /** Événements dont time ∈ ]debutMs ; finMs]. */
  evenements: EvenementVol[];
  /** finMs au-delà de la couverture du calendrier (ou couverture inconnue) : événements non vérifiés. */
  calendrierNonCouvert: boolean;
  /**
   * √max(σf² − σbase², 0) × √(dt/365), en % ; null sans événement, sans σ_base, si dt > 7 j ou
   * calendrier non couvert.
   */
  moveEvenementPct: number | null;
}

/**
 * Fin de couverture du calendrier ECO chargé : dernier événement daté par ForexFactory (semaine
 * courante) ou FRED (publications à ~45 j), toutes devises et impacts ; les dates FOMC statiques
 * sont exclues (elles ne disent rien des autres publications). null sans source datée. PURE.
 */
export function finCouvertureCalendrier(evenements: readonly Pick<EcoEvent, "time" | "source">[]): number | null {
  let fin: number | null = null;
  for (const e of evenements) if (e.source !== "fomc" && (fin === null || e.time > fin)) fin = e.time;
  return fin;
}

/** Médiane d'une liste non vide. */
function mediane(valeurs: number[]): number {
  const tri = [...valeurs].sort((a, b) => a - b);
  const m = Math.floor(tri.length / 2);
  return tri.length % 2 === 1 ? tri[m]! : (tri[m - 1]! + tri[m]!) / 2;
}

/**
 * Un segment par paire d'échéances consécutives (même ordre que `points`). `finCouvertureMs` =
 * `finCouvertureCalendrier` du calendrier chargé (null : aucune fenêtre couverte).
 */
export function volsForward(
  points: readonly { expiryMs: number; ivAtm: number }[],
  nowMs: number,
  evenements: readonly EvenementVol[],
  finCouvertureMs: number | null,
): SegmentVolForward[] {
  const segments: SegmentVolForward[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const dtJours = (b.expiryMs - a.expiryMs) / MS_PAR_JOUR;
    const masque = a.expiryMs - nowMs < SEUIL_MASQUE_MS;
    let sigmaFwd: number | null = null;
    let varianceNegative = false;
    if (!masque) {
      const t1 = (a.expiryMs - nowMs) / MS_PAR_JOUR / JOURS_PAR_AN;
      const t2 = (b.expiryMs - nowMs) / MS_PAR_JOUR / JOURS_PAR_AN;
      const variance = (b.ivAtm * b.ivAtm * t2 - a.ivAtm * a.ivAtm * t1) / (t2 - t1);
      if (variance > 0) sigmaFwd = Math.sqrt(variance);
      else varianceNegative = true;
    }
    segments.push({
      debutMs: a.expiryMs,
      finMs: b.expiryMs,
      dtJours,
      sigmaFwd,
      varianceNegative,
      masque,
      move1SigmaPct: sigmaFwd === null ? null : sigmaFwd * Math.sqrt(dtJours / JOURS_PAR_AN),
      evenements: evenements.filter((e) => e.time > a.expiryMs && e.time <= b.expiryMs),
      calendrierNonCouvert: finCouvertureMs === null || b.expiryMs > finCouvertureMs,
      moveEvenementPct: null,
    });
  }

  // Fenêtres courtes au calendrier vérifié : seules admises dans σ_base et lues pour la part.
  const courtes = (s: SegmentVolForward) =>
    s.sigmaFwd !== null && s.dtJours <= DT_BASE_MAX_JOURS && !s.calendrierNonCouvert;
  const pool = segments.filter((s) => courtes(s) && s.evenements.length === 0).map((s) => s.sigmaFwd!);
  if (pool.length === 0) return segments;
  const base = mediane(pool);
  for (const s of segments) {
    if (!courtes(s) || s.evenements.length === 0) continue;
    const exces = Math.max(s.sigmaFwd! * s.sigmaFwd! - base * base, 0);
    s.moveEvenementPct = Math.sqrt(exces) * Math.sqrt(s.dtJours / JOURS_PAR_AN);
  }
  return segments;
}

/** Libellé court (≤ 6 caractères) d'une publication ECO, pour le canvas et le tableau. */
export function libelleCourtEvenement(titre: string): string {
  const t = titre.toLowerCase();
  if (t.includes("fomc") || t.includes("federal funds")) return "FOMC";
  if (t.includes("cpi") || t.includes("consumer price")) return "CPI";
  if (t.includes("non-farm") || t.includes("nfp") || t.includes("employment situation")) return "NFP";
  if (t.includes("pce") || t.includes("personal income")) return "PCE";
  if (t.includes("gdp") || t.includes("gross domestic")) return "PIB";
  return "Évt";
}
