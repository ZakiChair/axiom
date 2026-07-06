/**
 * Cône de volatilité — dispersion historique de la volatilité réalisée (RV) par horizon,
 * pour situer une RV (ou l'IV/DVOL) courante par rapport à son propre historique.
 *
 * `realizedVolSeries` reprend EXACTEMENT la formule de RV de @axiom/indicators (Task 7,
 * `packages/indicators/src/volatility/rv.ts`) — écart-type POPULATION des log-rendements,
 * annualisé — mais renvoyée en série complète avec `null` (et non `undefined`) pour les
 * positions dont la fenêtre est incomplète. Implémentation indépendante et volontairement
 * dupliquée : ce module ne dépend PAS de @axiom/indicators.
 *
 * `volCone` calcule, pour chaque horizon, la série RV(window=horizon) sur tout
 * l'historique de closes, puis ses percentiles (5/25/50/75/95) — la forme classique du
 * « vol cone » utilisée pour juger si une vol (implicite ou réalisée) est chère ou bon
 * marché par rapport à la distribution historique de la volatilité réalisée.
 */

// ─────────────────────────── RV en série complète ───────────────────────────

/**
 * Volatilité réalisée annualisée (%), en série complète alignée sur `closes`.
 * rv[i] = stdev_population(logReturns[i-window+1..i]) × √periodsPerYear × 100.
 * `null` tant que la fenêtre de `window` log-rendements n'est pas pleine (au lieu
 * d'`undefined` — convention DIFFÉRENTE de @axiom/indicators, requise par ce module).
 */
export function realizedVolSeries(
  closes: number[],
  window: number,
  periodsPerYear: number,
): (number | null)[] {
  const n = closes.length;
  const logReturns: (number | undefined)[] = new Array(n).fill(undefined);
  for (let i = 1; i < n; i++) {
    const prev = closes[i - 1];
    const curr = closes[i];
    if (prev !== undefined && curr !== undefined && prev > 0) {
      logReturns[i] = Math.log(curr / prev);
    }
  }

  const out: (number | null)[] = new Array(n).fill(null);
  const facteurAnnualisation = Math.sqrt(periodsPerYear) * 100;

  for (let i = window; i < n; i++) {
    let somme = 0;
    let sommeCarres = 0;
    let compte = 0;
    for (let j = i - window + 1; j <= i; j++) {
      const v = logReturns[j];
      if (v !== undefined) {
        somme += v;
        sommeCarres += v * v;
        compte += 1;
      }
    }
    if (compte === window) {
      // Variance populationnelle = (Σx² - (Σx)²/N) / N. Clamp contre erreurs flottantes.
      let variance = (sommeCarres - (somme * somme) / window) / window;
      if (variance < 0) variance = 0;
      out[i] = Math.sqrt(variance) * facteurAnnualisation;
    }
  }
  return out;
}

// ─────────────────────────── Percentile (interpolation linéaire) ───────────────────────────

/**
 * Percentile `p` (0-100) d'un tableau TRIÉ ASCENDANT, par interpolation linéaire entre
 * les deux rangs encadrants (méthode « linéaire » — convention Excel PERCENTILE.INC /
 * numpy par défaut). Renvoie NaN si `sortedAsc` est vide (percentile non défini).
 */
export function percentile(sortedAsc: number[], p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return NaN;
  const rang = (p / 100) * (n - 1);
  const bas = Math.floor(rang);
  const haut = Math.ceil(rang);
  const valBas = sortedAsc[bas];
  const valHaut = sortedAsc[haut];
  if (valBas === undefined || valHaut === undefined) return NaN; // hors bornes (ne devrait pas arriver)
  return valBas + (rang - bas) * (valHaut - valBas);
}

// ─────────────────────────── Cône de volatilité ───────────────────────────

/** Une ligne du cône : percentiles de RV(horizon) sur tout l'historique + valeur courante. */
export interface VolConeRow {
  horizon: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  /** Dernière valeur de RV(horizon) ; `null` si `closes` est trop court pour cet horizon. */
  current: number | null;
}

/** Horizons par défaut (en jours) — vue standard d'un cône de volatilité desk. */
const HORIZONS_DEFAUT = [7, 14, 30, 60, 90];
/** Convention d'annualisation par défaut (365 j — marché crypto continu). */
const PPA_DEFAUT = 365;

/**
 * Cône de volatilité : pour chaque horizon, la série `realizedVolSeries(closes, horizon,
 * periodsPerYear)` est calculée sur tout l'historique, puis triée pour en extraire les
 * percentiles 5/25/50/75/95. `current` = dernière valeur de cette série (peut être `null`
 * si `closes` est trop court pour l'horizon considéré).
 */
export function volCone(
  closes: number[],
  horizons: number[] = HORIZONS_DEFAUT,
  periodsPerYear: number = PPA_DEFAUT,
): VolConeRow[] {
  return horizons.map((horizon) => {
    const serie = realizedVolSeries(closes, horizon, periodsPerYear);
    const valeurs = serie.filter((v): v is number => v !== null).sort((a, b) => a - b);
    return {
      horizon,
      p5: percentile(valeurs, 5),
      p25: percentile(valeurs, 25),
      p50: percentile(valeurs, 50),
      p75: percentile(valeurs, 75),
      p95: percentile(valeurs, 95),
      current: serie[serie.length - 1] ?? null,
    };
  });
}

// ─────────────────────────── Z-score ───────────────────────────

/**
 * Z-score de `current` par rapport à la distribution `values` (écart-type POPULATION,
 * même convention que `realizedVolSeries`). Renvoie `null` si l'écart-type est nul
 * (distribution constante — division impossible) ou si `values` a moins de 2 éléments
 * (dispersion non définie).
 */
export function zScore(values: number[], current: number): number | null {
  const n = values.length;
  if (n < 2) return null;
  const moyenne = values.reduce((acc, v) => acc + v, 0) / n;
  const variance = values.reduce((acc, v) => acc + (v - moyenne) ** 2, 0) / n;
  const ecartType = Math.sqrt(variance);
  if (ecartType === 0) return null;
  return (current - moyenne) / ecartType;
}
