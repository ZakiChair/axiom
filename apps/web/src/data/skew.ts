/**
 * Skew 25Δ (risk reversal) — RR25 = IV(call 25Δ) − IV(put 25Δ) d'une échéance (fonction PURE).
 *
 * Le delta de chaque option est calculé côté client par Black-Scholes (bsGreeks) avec l'IV mark
 * PROPRE au point — même approche que gexDex.ts (le résumé de carnet Deribit ne renvoie pas les
 * greeks). Choix documenté : sélection PLUS-PROCHE-VOISIN, pas d'interpolation entre strikes —
 * aucun calcul d'options du dépôt n'interpole (max pain et GEX/DEX travaillent sur strikes
 * discrets ; les interpolations existantes relèvent du rendu graphique/percentiles) — et les
 * strikes retenus restent ainsi des strikes RÉELS, affichables. Un RR25 négatif = puts plus
 * chers que les calls équidistants en delta = skew baissier.
 *
 * `nowMs` est injecté par l'appelant (fonction PURE — convention du dépôt). Testé (skew.test.ts).
 */
import { bsGreeks } from "./blackScholes";

/** Millisecondes dans une année (base 365 j — convention du dépôt). */
const MS_PAR_AN = 365 * 24 * 60 * 60 * 1000;

/** Cible de delta du risk reversal : +0,25 pour le call, −0,25 pour le put. */
const DELTA_CIBLE = 0.25;

/**
 * Écart maximal toléré entre le delta du candidat et la cible ±0,25. Au-delà (grille de
 * strikes trop clairsemée, chaîne dégénérée sans jambe vers 25Δ), pas de RR25 → null.
 */
const TOLERANCE_DELTA = 0.1;

/** Input minimal d'une option pour le calcul du skew (compatible OptionPoint). */
export interface OptionSkewInput {
  strike: number;
  type: "call" | "put";
  /** Volatilité implicite mark en POURCENTAGE (Deribit renvoie déjà en %). */
  markIv: number;
  /** Taux sans risque en fraction (Deribit `interest_rate`, ex. 0). */
  interestRate: number;
  /** Échéance (ms epoch). */
  expiryMs: number;
}

/** Résultat du skew 25Δ d'une échéance : RR25 en points d'IV + jambes retenues. */
export interface Skew25d {
  /** RR25 = IV(call 25Δ) − IV(put 25Δ), en POINTS d'IV (%). Négatif = puts chers (baissier). */
  rr25: number;
  /** Strike réel du call retenu (delta le plus proche de +0,25). */
  strikeCall: number;
  /** Strike réel du put retenu (delta le plus proche de −0,25). */
  strikePut: number;
  /** IV mark (%) des jambes retenues. */
  ivCall: number;
  ivPut: number;
}

/** Meilleur candidat d'un côté (call ou put) : jambe et écart de delta à la cible. */
interface Candidat {
  strike: number;
  iv: number;
  ecart: number;
}

/**
 * Skew 25Δ d'UNE échéance (points déjà filtrés par l'appelant, cf. pointsEcheance d'OMON) :
 * retient le call au delta le plus proche de +0,25 et le put le plus proche de −0,25 (dans la
 * tolérance ±0,10), et renvoie RR25 = ivCall − ivPut + strikes retenus. Les points à IV
 * manquante/nulle ou expirés (T ≤ 0 → greeks NaN) sont écartés. Renvoie null si le spot est
 * invalide ou si un des deux côtés n'a aucun candidat. Fonction PURE.
 */
export function calculerSkew25d(
  points: OptionSkewInput[],
  spot: number,
  nowMs: number,
): Skew25d | null {
  if (!Number.isFinite(spot) || spot <= 0) return null;
  let call: Candidat | null = null;
  let put: Candidat | null = null;
  for (const p of points) {
    if (!Number.isFinite(p.markIv) || p.markIv <= 0) continue;
    const t = (p.expiryMs - nowMs) / MS_PAR_AN;
    const g = bsGreeks(spot, p.strike, t, p.markIv / 100, p.interestRate);
    const delta = p.type === "call" ? g.deltaCall : g.deltaPut;
    if (!Number.isFinite(delta)) continue;
    const ecart = Math.abs(delta - (p.type === "call" ? DELTA_CIBLE : -DELTA_CIBLE));
    if (ecart > TOLERANCE_DELTA) continue;
    if (p.type === "call") {
      if (!call || ecart < call.ecart) call = { strike: p.strike, iv: p.markIv, ecart };
    } else {
      if (!put || ecart < put.ecart) put = { strike: p.strike, iv: p.markIv, ecart };
    }
  }
  if (!call || !put) return null;
  return {
    rr25: call.iv - put.iv,
    strikeCall: call.strike,
    strikePut: put.strike,
    ivCall: call.iv,
    ivPut: put.iv,
  };
}
