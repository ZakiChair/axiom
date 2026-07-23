/**
 * DIST — distribution EMPIRIQUE des rendements du chart projetée en NIVEAUX de prix
 * (VaR/CVaR par horizon). Calcul 100 % PUR et testé (distVar.test.ts) : aucune source
 * réseau nouvelle — les closes proviennent des candles du chart maître, déjà chargées ;
 * la fenêtre (T2) fournira ces closes et consommera la sortie.
 *
 * Méthode :
 *  1. écarter les closes non finis EN AMONT ; exiger ≥ 300 closes finis (sinon null) ;
 *  2. log-rendements 1-bougie r_t = ln(close_t / close_{t-1}) sur les closes finis ;
 *  3. par horizon h : sommes GLISSANTES chevauchantes de h rendements consécutifs
 *     (fenêtres i..i+h−1) — c'est la distribution empirique du rendement cumulé sur h
 *     bougies (échantillons corrélés, assumé : distribution empirique, PAS une prévision) ;
 *  4. quantiles p1/p5/p50/p95/p99 par interpolation linéaire (type 7) sur ces sommes ;
 *  5. chaque quantile q donne DEUX vues du MÊME point : prix = dernierClose·exp(q) et
 *     % vs dernierClose = (exp(q) − 1)·100 ; CVaR95 = moyenne des sommes ≤ q(0.05),
 *     mappée de même en prix/%.
 */

/** Horizons de projection, en bougies. */
export const HORIZONS = [1, 5, 20] as const;

/** Niveaux VaR/CVaR pour un horizon h. */
export interface NiveauxVar {
  h: number;
  nEchantillons: number;
  /** Niveaux de prix (dernierClose × exp(q)). */
  niveaux: { p1: number; p5: number; p50: number; p95: number; p99: number };
  /** Mêmes niveaux en % vs dernierClose ((exp(q) − 1)·100). */
  pct: { p1: number; p5: number; p50: number; p95: number; p99: number };
  /** CVaR95 (moyenne de la queue ≤ p5) en niveau de prix. */
  cvar95Niveau: number;
  /** CVaR95 en % vs dernierClose. */
  cvar95Pct: number;
}

/**
 * Quantile `q` (∈ [0,1]) par interpolation linéaire, convention « type 7 » (défaut de
 * R/numpy) : position = q·(n−1) sur les valeurs FINIES triées croissant, interpolation
 * entre les deux voisins. Valeurs non finies exclues ; liste finie vide → undefined.
 *
 * PROVENANCE : copie locale VOLONTAIRE de `quantile` de
 * `apps/web/src/components/squeezeWindow.util.ts` (v1.5). Un module `data/` qui importe un
 * util de `components/` créerait une arête data→components INHABITUELLE (aucune n'existe
 * aujourd'hui) ; la duplication préserve le sens des dépendances. PURE.
 */
export function quantile(valeurs: readonly number[], q: number): number | undefined {
  const finis = valeurs.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = finis.length;
  if (n === 0) return undefined;
  if (n === 1) return finis[0];
  const pos = q * (n - 1);
  const bas = Math.floor(pos);
  const haut = Math.ceil(pos);
  const frac = pos - bas;
  return finis[bas]! + (finis[haut]! - finis[bas]!) * frac;
}

/**
 * Log-rendements 1-bougie r_t = ln(close_t / close_{t-1}) sur une série de closes
 * (supposés finis et positifs — filtrés en amont par distVar). Longueur = n−1. PURE.
 */
export function logRendements1(closes: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    out.push(Math.log(closes[i]! / closes[i - 1]!));
  }
  return out;
}

/**
 * Sommes GLISSANTES chevauchantes de `h` valeurs consécutives : sortie[i] = Σ valeurs[i..i+h−1].
 * Longueur = n − h + 1 (vide si h < 1 ou n < h). Représente le rendement cumulé sur h
 * bougies quand les valeurs sont des log-rendements 1-bougie. PURE.
 */
export function sommesGlissantes(valeurs: readonly number[], h: number): number[] {
  if (h < 1 || valeurs.length < h) return [];
  const out: number[] = [];
  for (let i = 0; i + h <= valeurs.length; i++) {
    let s = 0;
    for (let k = 0; k < h; k++) s += valeurs[i + k]!;
    out.push(s);
  }
  return out;
}

/**
 * CVaR (expected shortfall) de la queue INFÉRIEURE : moyenne des valeurs finies ≤ le
 * quantile `q`. NaN si aucune valeur finie ≤ ce seuil (ex. liste vide). PURE.
 */
export function cvarInf(valeurs: readonly number[], q: number): number {
  const seuil = quantile(valeurs, q);
  if (seuil === undefined) return NaN;
  let somme = 0;
  let nb = 0;
  for (const v of valeurs) {
    if (Number.isFinite(v) && v <= seuil) {
      somme += v;
      nb += 1;
    }
  }
  return nb === 0 ? NaN : somme / nb;
}

/**
 * Distribution empirique des rendements en niveaux de prix, par horizon. Renvoie null si
 * moins de 300 closes FINIS (échantillon insuffisant). Les closes non finis sont écartés
 * EN AMONT ; le dernier close fini sert de référence prix. Un horizon dont la fenêtre
 * dépasse l'historique disponible est omis (sommes vides). PURE.
 */
export function distVar(
  closes: readonly number[],
  horizons: readonly number[] = HORIZONS,
): NiveauxVar[] | null {
  const finis = closes.filter((c) => Number.isFinite(c));
  if (finis.length < 300) return null;
  const dernierClose = finis[finis.length - 1]!;
  const rend = logRendements1(finis);

  const resultats: NiveauxVar[] = [];
  for (const h of horizons) {
    const sommes = sommesGlissantes(rend, h);
    if (sommes.length === 0) continue;
    // sommes non vide et finie ⇒ quantile jamais undefined (assertion justifiée).
    const enPrix = (q: number): number => dernierClose * Math.exp(q);
    const enPct = (q: number): number => (Math.exp(q) - 1) * 100;
    const q01 = quantile(sommes, 0.01)!;
    const q05 = quantile(sommes, 0.05)!;
    const q50 = quantile(sommes, 0.5)!;
    const q95 = quantile(sommes, 0.95)!;
    const q99 = quantile(sommes, 0.99)!;
    const cvarQ = cvarInf(sommes, 0.05);
    resultats.push({
      h,
      nEchantillons: sommes.length,
      niveaux: {
        p1: enPrix(q01),
        p5: enPrix(q05),
        p50: enPrix(q50),
        p95: enPrix(q95),
        p99: enPrix(q99),
      },
      pct: {
        p1: enPct(q01),
        p5: enPct(q05),
        p50: enPct(q50),
        p95: enPct(q95),
        p99: enPct(q99),
      },
      cvar95Niveau: enPrix(cvarQ),
      cvar95Pct: enPct(cvarQ),
    });
  }
  return resultats;
}
