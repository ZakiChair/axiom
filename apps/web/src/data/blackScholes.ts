/**
 * Black-Scholes — greeks PURS pour le calcul GEX/DEX crypto (côté client, zéro réseau).
 *
 * Deribit renvoie déjà tous les inputs (spot, IV mark, taux, open interest) dans l'appel
 * agrégé `get_book_summary_by_currency` déjà utilisé par la fenêtre OMON ; le strike, le type
 * et l'échéance sont extraits par `parseOptionInstrument`. Il ne manque QUE delta et gamma,
 * que Deribit ne renvoie pas au niveau du résumé de carnet — on les calcule donc ici par la
 * formule Black-Scholes standard, sans aucune dépendance externe (pas de lib stats).
 *
 * Le temps jusqu'à l'échéance `T` (en années) est calculé par l'APPELANT et passé en
 * paramètre — la fonction reste ainsi PURE et testable (convention d'injection du temps du
 * dépôt, cf. `isMarketOpen`). Toutes les fonctions ici sont pures et testées (blackScholes.test.ts).
 */

/**
 * Densité de probabilité de la loi normale centrée réduite : φ(x) = (1/√(2π))·e^(−x²/2).
 * Fonction PURE.
 */
export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Fonction de répartition de la loi normale centrée réduite N(x), par l'approximation
 * rationnelle d'Abramowitz & Stegun 26.2.17 (Zelen & Severo), précise à ~7,5·10⁻⁸.
 * Utilise la symétrie N(−x) = 1 − N(x). Fonction PURE.
 *
 * Repères : N(0)=0,5 ; N(1,96)≈0,975 ; N(−1,96)≈0,025.
 */
export function normCdf(x: number): number {
  if (!Number.isFinite(x)) return Number.NaN;
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  // Polynôme de Horner sur les coefficients b1..b5.
  const poly =
    t * (0.319381530 +
    t * (-0.356563782 +
    t * (1.781477937 +
    t * (-1.821255978 +
    t * 1.330274429))));
  const tail = normPdf(x) * poly; // = 1 − N(|x|) pour x ≥ 0
  return x >= 0 ? 1 - tail : tail;
}

/** Greeks Black-Scholes d'un même strike (calls ET puts partagent gamma). */
export interface BsGreeks {
  d1: number;
  d2: number;
  /** N(d1) ∈ [0, 1]. */
  deltaCall: number;
  /** N(d1) − 1 ∈ [−1, 0] (parité delta call/put). */
  deltaPut: number;
  /** φ(d1) / (S·σ·√T) ≥ 0 (identique calls/puts). */
  gamma: number;
}

const NAN_GREEKS: BsGreeks = {
  d1: Number.NaN,
  d2: Number.NaN,
  deltaCall: Number.NaN,
  deltaPut: Number.NaN,
  gamma: Number.NaN,
};

/**
 * Greeks Black-Scholes standard sans dividende (approprié pour les options crypto Deribit,
 * réglées en cash sur l'index) :
 *
 *   d1 = (ln(S/K) + (r + σ²/2)·T) / (σ·√T)
 *   d2 = d1 − σ·√T
 *   delta_call = N(d1)          delta_put = N(d1) − 1
 *   gamma      = φ(d1) / (S·σ·√T)
 *
 * @param s      Spot (sous-jacent), > 0.
 * @param k      Strike, > 0.
 * @param t      Temps jusqu'à l'échéance en ANNÉES (calculé par l'appelant), > 0.
 * @param sigma  Volatilité implicite en FRACTION (ex. 0,4056 pour 40,56 %), > 0.
 * @param r      Taux sans risque en fraction (ex. 0). Défaut 0.
 *
 * Renvoie des greeks NaN si un input est non fini ou non strictement positif (S, K, T, σ) :
 * l'appelant/agrégateur filtre alors le point (dégradation gracieuse, jamais d'exception).
 * Fonction PURE.
 */
export function bsGreeks(s: number, k: number, t: number, sigma: number, r = 0): BsGreeks {
  if (
    !Number.isFinite(s) || s <= 0 ||
    !Number.isFinite(k) || k <= 0 ||
    !Number.isFinite(t) || t <= 0 ||
    !Number.isFinite(sigma) || sigma <= 0 ||
    !Number.isFinite(r)
  ) {
    return NAN_GREEKS;
  }
  const sqrtT = Math.sqrt(t);
  const volSqrtT = sigma * sqrtT;
  const d1 = (Math.log(s / k) + (r + 0.5 * sigma * sigma) * t) / volSqrtT;
  const d2 = d1 - volSqrtT;
  const deltaCall = normCdf(d1);
  return {
    d1,
    d2,
    deltaCall,
    deltaPut: deltaCall - 1,
    gamma: normPdf(d1) / (s * volSqrtT),
  };
}
