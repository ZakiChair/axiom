/**
 * Probabilités implicites d'un niveau (fonctions PURES) — vue Smile d'OMON.
 *
 * P(clôture > K à T), RISQUE-NEUTRE (Breeden-Litzenberger 1978) : avec r = 0 (interest_rate
 * Deribit = 0), −∂C/∂K = P(S_T > K). Sur une grille discrète de strikes :
 *   1. prix de call USD par strike, marks Deribit (unités de base) × forward de l'échéance.
 *      Sous le forward, le call est reconstruit par parité depuis le put hors de la monnaie,
 *      C = P·F + (F − K) : un mark de call ITM converti × F porte l'écart entre l'underlying de
 *      son instrument et le forward commun sur toute sa valeur intrinsèque ; au-dessus, call
 *      direct. À défaut, le côté disponible avec la même règle ; strike sans mark fini exclu ;
 *   2. pente de chaque intervalle [Kᵢ ; Kᵢ₊₁] affectée à son MILIEU (correction du vérificateur :
 *      la règle K1 < K ≤ K2 biaise jusqu'à 3,7 pts et saute à chaque strike) ;
 *   3. bornée à [0 ; 1], puis monotonie imposée (balayage croissant, pᵢ = min(pᵢ, pᵢ₋₁)) ;
 *   4. lecture par interpolation linéaire entre milieux, null hors de la grille.
 *
 * P(toucher K avant T), MODÈLE LOG-NORMAL : barrière sans dérive, 2·Φ(−|ln(K/F)| / (σ√T)), σ =
 * IV ATM de l'échéance (source unique d'IV). Surestime en pratique le taux de contact observé.
 *
 * LIMITES : mesure risque-neutre, pas une probabilité réelle ; marks = surface modèle Deribit,
 * pas des cotations ; précision bornée par l'écart entre strikes (2 000 à 5 000 USD loin de la
 * monnaie) ; la monotonie par minimum propage une pente bruitée basse à toute la queue haute.
 *
 * ZÉRO fetch : consomme les points de l'échéance déjà pollés par OMON ; `nowMs` injecté.
 * Module PARESSEUX : importé seulement par OptionsWindow (jamais depuis un module d'entrée).
 */
import type { OptionPoint } from "./deribit";
import { normCdf } from "./blackScholes";

/** Base 365 j (convention du dépôt, cf. skew.ts, mouvementAttendu.ts). */
const MS_PAR_AN = 365 * 24 * 60 * 60 * 1000;

export interface CourbeProbaImplicite {
  expiryMs: number;
  /** underlying_price de l'échéance (forward). */
  forward: number;
  /** Temps jusqu'à l'échéance, en années. */
  t: number;
  /** IV mark (%) au strike le plus proche du forward (moyenne call/put) : source UNIQUE d'IV pour P(toucher). */
  ivAtm: number | null;
  /** Milieux (Kᵢ + Kᵢ₊₁)/2, triés croissants. */
  milieux: number[];
  /** P(S_T > milieu), bornée à [0 ; 1] et non croissante. */
  probas: number[];
}

const markFini = (m: number | undefined): m is number => m !== undefined && Number.isFinite(m) && m >= 0;

/**
 * Courbe P(S_T > K) d'UNE échéance (points d'une seule échéance, ex. `pointsEcheance`).
 * Null si forward invalide, T ≤ 0 ou moins de 3 strikes exploitables.
 */
export function courbeProbaImplicite(points: readonly OptionPoint[], nowMs: number): CourbeProbaImplicite | null {
  const premier = points[0];
  if (premier === undefined) return null;
  const forward = points.map((p) => p.underlying).find((u) => Number.isFinite(u) && u > 0);
  if (forward === undefined) return null;
  const t = (premier.expiryMs - nowMs) / MS_PAR_AN;
  if (!(t > 0)) return null;

  const parStrike = new Map<number, { call?: number; put?: number; ivs: number[] }>();
  for (const p of points) {
    const cur = parStrike.get(p.strike) ?? { ivs: [] };
    if (p.type === "call") cur.call = p.markPrice;
    else cur.put = p.markPrice;
    if (Number.isFinite(p.markIv) && p.markIv > 0) cur.ivs.push(p.markIv);
    parStrike.set(p.strike, cur);
  }

  const strikes: number[] = [];
  const prixCall: number[] = [];
  let ivAtm: number | null = null;
  let ecartAtm = Infinity;
  for (const k of [...parStrike.keys()].sort((a, b) => a - b)) {
    const { call, put, ivs } = parStrike.get(k)!;
    const ecart = Math.abs(k - forward);
    if (ecart < ecartAtm) {
      ecartAtm = ecart;
      ivAtm = ivs.length === 0 ? null : ivs.reduce((s, v) => s + v, 0) / ivs.length;
    }
    const viaPut = markFini(put) ? put * forward + (forward - k) : null;
    const viaCall = markFini(call) ? call * forward : null;
    const c = k < forward ? (viaPut ?? viaCall) : (viaCall ?? viaPut);
    if (c === null) continue;
    strikes.push(k);
    prixCall.push(c);
  }
  if (strikes.length < 3) return null;

  const milieux: number[] = [];
  const probas: number[] = [];
  for (let i = 0; i + 1 < strikes.length; i++) {
    const k1 = strikes[i]!;
    const k2 = strikes[i + 1]!;
    const pente = (prixCall[i]! - prixCall[i + 1]!) / (k2 - k1);
    const bornee = Math.min(1, Math.max(0, pente));
    const precedente = probas.at(-1);
    milieux.push((k1 + k2) / 2);
    probas.push(precedente === undefined ? bornee : Math.min(bornee, precedente));
  }
  return { expiryMs: premier.expiryMs, forward, t, ivAtm, milieux, probas };
}

/** P(S_T > niveau) par interpolation linéaire entre milieux ; null hors de [milieux[0] ; dernier milieu]. */
export function probaClotureAuDessus(courbe: CourbeProbaImplicite, niveau: number): number | null {
  const { milieux, probas } = courbe;
  const bas = milieux[0];
  const haut = milieux.at(-1);
  if (bas === undefined || haut === undefined || !(niveau >= bas && niveau <= haut)) return null;
  for (let i = 0; i + 1 < milieux.length; i++) {
    const m1 = milieux[i]!;
    const m2 = milieux[i + 1]!;
    if (niveau <= m2) return probas[i]! + ((probas[i + 1]! - probas[i]!) * (niveau - m1)) / (m2 - m1);
  }
  return probas.at(-1) ?? null;
}

/** Barrière log-normale sans dérive : min(1, 2·Φ(−|ln(K/F)| / (σ√T))), σ = ivPct/100. Null si entrée invalide. */
export function probaToucher(niveau: number, forward: number, ivPct: number, t: number): number | null {
  if (![niveau, forward, ivPct, t].every((v) => Number.isFinite(v) && v > 0)) return null;
  return Math.min(1, 2 * normCdf(-Math.abs(Math.log(niveau / forward)) / ((ivPct / 100) * Math.sqrt(t))));
}

export interface LectureProbasNiveau {
  /** P(clôture > K à T), risque-neutre ; null hors grille. */
  pCloture: number | null;
  /** P(toucher K avant T), modèle log-normal à l'IV ATM de la courbe. */
  pToucher: number | null;
}

/** Les deux lectures d'un niveau (niveau saisi ou strike survolé) ; null si courbe absente ou niveau ≤ 0. */
export function lireProbasNiveau(courbe: CourbeProbaImplicite | null, niveau: number | null): LectureProbasNiveau {
  if (courbe === null || niveau === null || !(niveau > 0)) return { pCloture: null, pToucher: null };
  return {
    pCloture: probaClotureAuDessus(courbe, niveau),
    pToucher: courbe.ivAtm === null ? null : probaToucher(niveau, courbe.forward, courbe.ivAtm, courbe.t),
  };
}

/** Niveau proposé par défaut : forward arrondi à 3 chiffres significatifs (BTC au pas de 100, ETH de 10). */
export function niveauParDefaut(forward: number): number {
  const pas = 10 ** (Math.floor(Math.log10(forward)) - 2);
  return Math.round(forward / pas) * pas;
}
