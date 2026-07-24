/**
 * Calculs PURS de risque du portefeuille (consommés par la section « Risque » de
 * PortfolioWindow, T2). Toutes les fonctions sont sans effet de bord et déterministes.
 *
 * Conventions (décidées par le contrôleur, verrouillées en test) :
 *  - quantiles : convention « type 7 » (interpolation linéaire, défaut R/numpy) ;
 *  - VaR = −quantile des rendements ⇒ PERTE POSITIVE (le signe est le piège n°1) ;
 *  - CVaR95 = −moyenne des rendements ≤ quantile 5 % ;
 *  - covariances/variances POPULATION (divisées par n) COHÉRENTES partout : un seul
 *    couple d'helpers `covPop`/`varPop` alimente contributions ET bêtas ;
 *  - Σ contributions = 1 : identité qui tient UNIQUEMENT si cov(r_i, r_p) et var(r_p)
 *    sont calculés sur les MÊMES dates communes (intersection globale). D'où le pipeline
 *    partagé `alignerSurPortefeuille` qui produit r_p et les r_i alignés en une passe.
 */

export interface SerieActif {
  symbol: string;
  rendements: { t: number; r: number }[]; // rendements log 1 j, t = openTime
}

export interface PoidsPosition {
  symbol: string;
  poids: number; // $ signé (short < 0)
}

export interface RisquePortefeuille {
  var95Pct: number;
  var99Pct: number;
  cvar95Pct: number;
  nJours: number;
}

// ── Helpers numériques purs ──────────────────────────────────────────────────

/**
 * Quantile `q` (∈ [0,1]) par interpolation linéaire, convention « type 7 » (défaut de
 * R/numpy) : position = q·(n−1) sur les valeurs FINIES triées croissant, interpolation
 * entre les deux voisins. Valeurs non finies exclues ; liste finie vide → undefined.
 *
 * PROVENANCE : copie locale VOLONTAIRE de `quantile` de `apps/web/src/data/distVar.ts`
 * (précédent v1.6). Un module `data/` reste ainsi sans dépendance croisée superflue ; la
 * duplication préserve la clarté des dépendances. PURE.
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

/** Moyenne arithmétique (NaN si vide). PURE. */
function moyenne(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/**
 * Covariance POPULATION de deux séries ALIGNÉES (même longueur, indices appariés) :
 * Σ (x−x̄)(y−ȳ) / n. 0 si longueur nulle. PURE.
 */
function covPop(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  if (n === 0) return 0;
  const mx = moyenne(xs);
  const my = moyenne(ys);
  let s = 0;
  for (let i = 0; i < n; i++) s += (xs[i]! - mx) * (ys[i]! - my);
  return s / n;
}

/** Variance POPULATION (= covPop avec elle-même). PURE. */
function varPop(xs: readonly number[]): number {
  return covPop(xs, xs);
}

/**
 * Seuil sous lequel une variance est traitée comme NULLE. Une série CONSTANTE a une
 * variance mathématiquement nulle mais, en flottant, un cumul comme Σ(0,01·n)/n laisse un
 * résidu ~1e-36 : `=== 0` le raterait et ferait exploser un ratio cov/var. Les variances de
 * rendements réels valent ~1e-4…1e-2, très au-dessus de ce seuil : la séparation est nette.
 */
const EPS_VAR = 1e-12;

// ── Alignement portefeuille ──────────────────────────────────────────────────

interface AlignementPortefeuille {
  dates: number[]; // t communs à TOUTES les séries pondérées, triés croissant
  rp: number[]; // rendement pondéré du portefeuille sur `dates`
  parActif: { symbol: string; poidsNorm: number; ri: number[] }[]; // r_i alignés sur `dates`
}

/**
 * Aligne les séries pondérées sur l'intersection de leurs dates et produit, en UNE passe :
 * le rendement de portefeuille r_p = Σ (w_i/Σ|w|)·r_i et les r_i alignés par actif. Seuls
 * les actifs de `poids` disposant d'une série entrent dans Σ|w| et dans l'intersection.
 * `dates` vide ⇒ tout est vide. Base commune indispensable à l'identité Σ ctr = 1. PURE.
 */
function alignerSurPortefeuille(
  series: readonly SerieActif[],
  poids: readonly PoidsPosition[],
): AlignementPortefeuille {
  const parSymbol = new Map(series.map((s) => [s.symbol, s]));
  // Positions retenues : celles de `poids` qui ont une série disponible.
  const retenues = poids.filter((p) => parSymbol.has(p.symbol));
  const sommeAbs = retenues.reduce((s, p) => s + Math.abs(p.poids), 0);
  if (retenues.length === 0 || sommeAbs === 0) {
    return { dates: [], rp: [], parActif: [] };
  }

  // Intersection des dates : présentes dans CHAQUE série retenue.
  const mapsRendement = retenues.map(
    (p) => new Map(parSymbol.get(p.symbol)!.rendements.map((x) => [x.t, x.r])),
  );
  const [premiere, ...reste] = mapsRendement;
  const dates = [...premiere!.keys()]
    .filter((t) => reste.every((m) => m.has(t)))
    .sort((a, b) => a - b);

  if (dates.length === 0) return { dates: [], rp: [], parActif: [] };

  const parActif = retenues.map((p, idx) => ({
    symbol: p.symbol,
    poidsNorm: p.poids / sommeAbs,
    ri: dates.map((t) => mapsRendement[idx]!.get(t)!),
  }));

  const rp = dates.map((_, di) =>
    parActif.reduce((s, a) => s + a.poidsNorm * a.ri[di]!, 0),
  );

  return { dates, rp, parActif };
}

// ── API publique ─────────────────────────────────────────────────────────────

/**
 * Série des rendements pondérés du portefeuille sur l'intersection des dates.
 * r_p = Σ (w_i/Σ|w|)·r_i ; [] si aucune date commune (ou aucune position exploitable). PURE.
 */
export function serieRendementsPortefeuille(
  series: readonly SerieActif[],
  poids: readonly PoidsPosition[],
): { t: number; r: number }[] {
  const { dates, rp } = alignerSurPortefeuille(series, poids);
  return dates.map((t, i) => ({ t, r: rp[i]! }));
}

/**
 * VaR/CVaR historiques du portefeuille. `null` si < 30 rendements. VaR = −quantile
 * (perte exprimée positivement) ; CVaR95 = −moyenne des rendements ≤ quantile 5 %. PURE.
 */
export function risquePortefeuille(
  rp: readonly { r: number }[],
): RisquePortefeuille | null {
  if (rp.length < 30) return null;
  const rs = rp.map((x) => x.r);
  const q5 = quantile(rs, 0.05)!;
  const q1 = quantile(rs, 0.01)!;
  const queue = rs.filter((r) => r <= q5);
  return {
    var95Pct: -q5,
    var99Pct: -q1,
    cvar95Pct: -moyenne(queue),
    nJours: rp.length,
  };
}

/**
 * Contributions à la variance du portefeuille : ctr_i = w̃_i · cov(r_i, r_p)/var(r_p),
 * sur les dates communes. Σ ctr = 1 (identité, assertée en test). Une contribution
 * NÉGATIVE est attendue pour un hedge (short corrélé positivement). [] si var(r_p) = 0. PURE.
 */
export function contributionsRisque(
  series: readonly SerieActif[],
  poids: readonly PoidsPosition[],
): { symbol: string; ctr: number }[] {
  const { rp, parActif } = alignerSurPortefeuille(series, poids);
  const vp = varPop(rp);
  if (vp < EPS_VAR) return [];
  return parActif.map((a) => ({
    symbol: a.symbol,
    ctr: (a.poidsNorm * covPop(a.ri, rp)) / vp,
  }));
}

/**
 * Bêta de chaque actif vs une série de référence : cov(r_i, r_ref)/var(r_ref) sur les
 * dates communes PAR ACTIF (intersection paire à paire, pas l'intersection globale).
 * `null` si < 30 dates communes ou var(ref) = 0. PURE.
 */
export function betasVsRef(
  series: readonly SerieActif[],
  ref: SerieActif,
): { symbol: string; beta: number | null }[] {
  const mapRef = new Map(ref.rendements.map((x) => [x.t, x.r]));
  return series.map((s) => {
    const pairs = s.rendements
      .filter((x) => mapRef.has(x.t))
      .map((x) => [x.r, mapRef.get(x.t)!] as const);
    if (pairs.length < 30) return { symbol: s.symbol, beta: null };
    const ri = pairs.map((p) => p[0]);
    const rref = pairs.map((p) => p[1]);
    const vref = varPop(rref);
    if (vref < EPS_VAR) return { symbol: s.symbol, beta: null };
    return { symbol: s.symbol, beta: covPop(ri, rref) / vref };
  });
}

/**
 * Grille de stress : pour chaque choc (%), impact linéaire Σ w_i · β_i · choc/100. Les
 * positions à β `null` sont EXCLUES de l'impact ; `couvertUsd` = Σ|w| des positions
 * INCLUSES (constante d'une ligne à l'autre). Chocs par défaut [−20,−10,10,20]. PURE.
 */
export function stressGrid(
  poids: readonly PoidsPosition[],
  betas: ReadonlyMap<string, number | null>,
  chocs: readonly number[] = [-20, -10, 10, 20],
): { chocPct: number; impactUsd: number; couvertUsd: number }[] {
  const inclus = poids
    .map((p) => ({ poids: p.poids, beta: betas.get(p.symbol) ?? null }))
    .filter((x): x is { poids: number; beta: number } => x.beta !== null);
  const couvertUsd = inclus.reduce((s, x) => s + Math.abs(x.poids), 0);
  return chocs.map((chocPct) => ({
    chocPct,
    impactUsd: inclus.reduce((s, x) => s + (x.poids * x.beta * chocPct) / 100, 0),
    couvertUsd,
  }));
}

/**
 * Courbe du P&L rétro-projeté de la composition ACTUELLE : equity_t = Σ signe_i · taille_i ·
 * (close_i,t − entree_i), sur l'intersection des dates. Base 0 = prix d'entrée théorique
 * (le caller fournit ~90 j de closes). Fonction PURE — aucune logique de fenêtre ici. PURE.
 */
export function equityHistorique(
  prix: ReadonlyMap<string, { t: number; close: number }[]>,
  tailles: ReadonlyMap<string, { taille: number; entree: number; signe: 1 | -1 }>,
): { t: number; equity: number }[] {
  // Positions à la fois pondérées et pourvues d'une série de prix.
  const symbols = [...tailles.keys()].filter((s) => prix.has(s));
  if (symbols.length === 0) return [];

  const mapsClose = symbols.map((s) => new Map(prix.get(s)!.map((p) => [p.t, p.close])));
  const [premiere, ...reste] = mapsClose;
  const dates = [...premiere!.keys()]
    .filter((t) => reste.every((m) => m.has(t)))
    .sort((a, b) => a - b);

  return dates.map((t) => ({
    t,
    equity: symbols.reduce((s, sym, idx) => {
      const pos = tailles.get(sym)!;
      const close = mapsClose[idx]!.get(t)!;
      return s + pos.signe * pos.taille * (close - pos.entree);
    }, 0),
  }));
}
