/**
 * @axiom/indicators — utils-cointegration.ts
 *
 * Noyau PARTAGÉ des deux indicateurs de cointégration (cointegrationAdf,
 * spreadHalfLife) : régression d'Engle-Granger en deux étapes sur deux séries de
 * prix alignées, fenêtre positionnelle.
 *
 *  1. régression de cointégration (log-log) :  y = α + β·x + e
 *     y = ln(close), x = ln(refClose)
 *  2. test ADF augmenté sur le RÉSIDU (sans constante, `lags` retards) :
 *       Δe_t = φ·e_{t−1} + Σ_{i=1..lags} γ_i·Δe_{t−i} + u_t
 *     Le t de Student de φ est la statistique d'Engle-Granger : φ = 0 ⇒ le spread
 *     est une marche aléatoire (pas de cointégration) ; φ < 0 ⇒ retour à la moyenne.
 *     Demi-vie = −ln 2 / ln(1 + φ), en barres.
 *
 * Conventions :
 *  - un point manquant (close ou ref) invalide TOUTE la fenêtre — pas de trou ;
 *  - β est ré-estimé à chaque fenêtre (Engle-Granger roulant), pas une fois pour
 *    toutes : un couple peut être cointégré sur une fenêtre et pas sur la suivante ;
 *  - la statistique t suit une distribution NON standard (le résidu est estimé, pas
 *    observé) : les valeurs critiques d'Engle-Granger/MacKinnon sont plus négatives
 *    que celles d'un ADF ordinaire. L'app trace le repère −3,34 (5 %, N=2, constante)
 *    comme approximation documentée, pas comme un test exact ;
 *  - `t` est null si le résidu de la régression ADF est EXACT (variance nulle) : un
 *    t infini n'est pas une mesure ;
 *  - `halfLife` est null si φ ≥ 0 (pas de retour) ou φ ≤ −1 (oscillation explosive) ;
 *  - biais de petit échantillon assumé : le résidu est ESTIMÉ (pas observé) et le
 *    t comme la demi-vie sont biaisés vers la stationnarité sur fenêtre courte —
 *    lire l'ORDRE de grandeur et la tendance, pas la valeur au dixième près.
 */

export interface EngleGranger {
  /** Pente log-log de la régression de cointégration (unités de ref par unité de close). */
  beta: number;
  /** t de Student du coefficient e_{t−1} de l'ADF augmenté (null si non calculable). */
  t: number | null;
  /** Demi-vie de retour à la moyenne, en barres (null si non mean-reverting). */
  halfLife: number | null;
}

/**
 * Élimination de Gauss avec pivot partiel sur un système k×k (A·x = b).
 * `A` (k² lignes majeures) et `b` sont MODIFIÉS. Renvoie null si singulier.
 */
function resoudre(A: number[], b: number[], k: number): number[] | null {
  // Seuil RELATIF à l'échelle de la matrice : sur des résidus ~1e-3, un seuil
  // absolu laisserait passer une matrice quasi singulière (pivots de bruit).
  let echelle = 0;
  for (let i = 0; i < k * k; i++) {
    const v = Math.abs(A[i]!);
    if (v > echelle) echelle = v;
  }
  const seuil = echelle * 1e-12;

  for (let col = 0; col < k; col++) {
    let pivot = col;
    let max = Math.abs(A[col * k + col]!);
    for (let r = col + 1; r < k; r++) {
      const v = Math.abs(A[r * k + col]!);
      if (v > max) {
        max = v;
        pivot = r;
      }
    }
    if (!(max > seuil)) return null;
    if (pivot !== col) {
      for (let c = col; c < k; c++) {
        const t = A[col * k + c]!;
        A[col * k + c] = A[pivot * k + c]!;
        A[pivot * k + c] = t;
      }
      const tb = b[col]!;
      b[col] = b[pivot]!;
      b[pivot] = tb;
    }
    const d = A[col * k + col]!;
    for (let r = col + 1; r < k; r++) {
      const f = A[r * k + col]! / d;
      if (f === 0) continue;
      for (let c = col; c < k; c++) A[r * k + c] = A[r * k + c]! - f * A[col * k + c]!;
      b[r] = b[r]! - f * b[col]!;
    }
  }
  const x = new Array<number>(k).fill(0);
  for (let r = k - 1; r >= 0; r--) {
    let s = b[r]!;
    for (let c = r + 1; c < k; c++) s -= A[r * k + c]! * x[c]!;
    const d = A[r * k + r]!;
    if (!(Math.abs(d) > seuil)) return null;
    x[r] = s / d;
  }
  return x;
}

/**
 * Engle-Granger sur la fenêtre [fin − length + 1 .. fin].
 * `closes` et `ref` sont alignés index par index sur les bougies (LOCF côté appelant).
 * Renvoie null si la fenêtre est incomplète, plate (var(log ref) = 0) ou trop courte
 * pour l'ADF augmenté demandé.
 */
export function engleGranger(
  closes: ReadonlyArray<number | undefined>,
  ref: ReadonlyArray<number | undefined>,
  fin: number,
  length: number,
  lags: number
): EngleGranger | null {
  const debut = fin - length + 1;
  if (debut < 0 || length < lags + 4) return null;

  // 1) Logs alignés — toute valeur manquante invalide la fenêtre.
  const ys = new Array<number>(length).fill(0);
  const xs = new Array<number>(length).fill(0);
  for (let k = 0; k < length; k++) {
    const c = closes[debut + k];
    const r = ref[debut + k];
    if (c === undefined || r === undefined) return null;
    if (!Number.isFinite(c) || !Number.isFinite(r) || c <= 0 || r <= 0) return null;
    ys[k] = Math.log(c);
    xs[k] = Math.log(r);
  }

  // 2) OLS y = α + β·x.
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (let k = 0; k < length; k++) {
    const x = xs[k]!;
    const y = ys[k]!;
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
  }
  const denX = length * sumXX - sumX * sumX;
  // Garde RELATIVE : une référence plate laisse un denX de bruit (~1e-13) qui
  // passerait un seuil absolu et produirait une pente arbitraire.
  if (!(denX > 1e-8 * length * sumXX)) return null;
  const beta = (length * sumXY - sumX * sumY) / denX;
  const alpha = (sumY - beta * sumX) / length;

  // 3) Résidus e_k = y_k − α − β·x_k.
  const e = new Array<number>(length).fill(0);
  for (let k = 0; k < length; k++) e[k] = ys[k]! - alpha - beta * xs[k]!;

  // 4) ADF augmenté sans constante : lignes t = lags+1 .. length−1 (index locaux).
  const kReg = lags + 1;
  const m = length - lags - 1;
  if (m < kReg + 2) return null;

  const A = new Array<number>(kReg * kReg).fill(0);
  const b = new Array<number>(kReg).fill(0);
  const lignes: number[] = [];
  for (let t = lags + 1; t < length; t++) lignes.push(t);
  if (lignes.length !== m) return null;

  for (const t of lignes) {
    const dE = e[t]! - e[t - 1]!;
    const regs: number[] = [e[t - 1]!];
    for (let i = 1; i <= lags; i++) regs.push(e[t - i]! - e[t - i - 1]!);
    for (let r = 0; r < kReg; r++) {
      const xr = regs[r]!;
      b[r] = b[r]! + xr * dE;
      for (let c = r; c < kReg; c++) A[r * kReg + c] = A[r * kReg + c]! + xr * regs[c]!;
    }
  }
  // Symétrie de X'X.
  for (let r = 0; r < kReg; r++) {
    for (let c = 0; c < r; c++) A[r * kReg + c] = A[c * kReg + r]!;
  }

  const theta = resoudre([...A], [...b], kReg);
  if (theta === null) return null;

  // RSS → σ² → se(φ) via (X'X)⁻¹[0][0] (résolution du système A·z = e_0).
  let rss = 0;
  for (const t of lignes) {
    const dE = e[t]! - e[t - 1]!;
    const regs: number[] = [e[t - 1]!];
    for (let i = 1; i <= lags; i++) regs.push(e[t - i]! - e[t - i - 1]!);
    let pred = 0;
    for (let r = 0; r < kReg; r++) pred += theta[r]! * regs[r]!;
    const u = dE - pred;
    rss += u * u;
  }
  const sigma2 = rss / (m - kReg);

  let t: number | null = null;
  if (sigma2 > 0) {
    const e0 = new Array<number>(kReg).fill(0);
    e0[0] = 1;
    const z = resoudre([...A], e0, kReg);
    if (z !== null && z[0]! > 0) {
      const se = Math.sqrt(sigma2 * z[0]!);
      if (se > 0) t = theta[0]! / se;
    }
  }

  const phi = theta[0]!;
  const halfLife = phi < 0 && phi > -1 ? -Math.LN2 / Math.log(1 + phi) : null;

  return { beta, t, halfLife };
}
