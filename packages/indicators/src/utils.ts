/**
 * @axiom/indicators — utils.ts
 *
 * Helpers de calcul PURS et réutilisables (aucun effet de bord, aucune dépendance).
 * Convention commune : les positions précédant la première fenêtre pleine valent
 * `undefined` (pas de valeur calculable). Les tableaux de sortie ont toujours la
 * même longueur que l'entrée et sont alignés index par index sur les bougies.
 *
 * NB : `noUncheckedIndexedAccess` est actif — tout accès indexé est traité comme
 * potentiellement `undefined` et gardé explicitement.
 */

import type { Candle } from "@axiom/types";

/** Extrait la série des prix de clôture d'un tableau de bougies. */
export function closeOf(candles: Candle[]): number[] {
  return candles.map((c) => c.close);
}

/**
 * Moyenne mobile simple (SMA) sur `length` valeurs.
 * Les `length - 1` premières positions valent `undefined`.
 */
export function sma(values: number[], length: number): Array<number | undefined> {
  // Quantifie la fenêtre : une longueur fractionnaire produirait des index
  // fractionnaires (values[i - 14.5] === undefined) et une somme divergente.
  length = Math.round(length);
  const n = values.length;
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  if (length <= 0) return out;

  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v !== undefined) sum += v;
    if (i >= length) {
      const old = values[i - length];
      if (old !== undefined) sum -= old;
    }
    if (i >= length - 1) out[i] = sum / length;
  }
  return out;
}

/**
 * Moyenne mobile exponentielle (EMA).
 * Coefficient k = 2 / (length + 1), amorcée par la SMA des `length` premières
 * valeurs (placée à l'index `length - 1`). Avant cela : `undefined`.
 */
export function ema(values: number[], length: number): Array<number | undefined> {
  length = Math.round(length); // fenêtre entière obligatoire (voir sma)
  const n = values.length;
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  if (length <= 0 || n < length) return out;

  const k = 2 / (length + 1);

  // Amorce : SMA des `length` premières valeurs.
  let seed = 0;
  for (let i = 0; i < length; i++) {
    const v = values[i];
    if (v !== undefined) seed += v;
  }
  let prev = seed / length;
  out[length - 1] = prev;

  for (let i = length; i < n; i++) {
    const v = values[i];
    if (v === undefined) continue;
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 * Lissage de Wilder (RMA / SMMA), utilisé par RSI et ATR.
 * Coefficient alpha = 1 / length, amorcé par la SMA des `length` premières
 * valeurs (placée à l'index `length - 1`). Avant cela : `undefined`.
 */
export function rma(values: number[], length: number): Array<number | undefined> {
  length = Math.round(length); // fenêtre entière obligatoire (voir sma)
  const n = values.length;
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  if (length <= 0 || n < length) return out;

  // Amorce : SMA des `length` premières valeurs.
  let seed = 0;
  for (let i = 0; i < length; i++) {
    const v = values[i];
    if (v !== undefined) seed += v;
  }
  let prev = seed / length;
  out[length - 1] = prev;

  for (let i = length; i < n; i++) {
    const v = values[i];
    if (v === undefined) continue;
    // Forme équivalente à (prev * (length - 1) + v) / length.
    prev = prev + (v - prev) / length;
    out[i] = prev;
  }
  return out;
}

/**
 * Écart-type roulant sur `length` valeurs.
 * `population = true` (défaut) : divise par N (convention TradingView Bollinger).
 * `population = false` : écart-type d'échantillon (divise par N - 1).
 * Les `length - 1` premières positions valent `undefined`.
 */
export function stdev(
  values: number[],
  length: number,
  population: boolean = true
): Array<number | undefined> {
  length = Math.round(length); // fenêtre entière obligatoire (voir sma)
  const n = values.length;
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  if (length <= 0 || n < length) return out;

  const denom = population ? length : length - 1;
  if (denom <= 0) return out; // échantillon non défini pour length === 1

  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v !== undefined) {
      sum += v;
      sumSq += v * v;
    }
    if (i >= length) {
      const old = values[i - length];
      if (old !== undefined) {
        sum -= old;
        sumSq -= old * old;
      }
    }
    if (i >= length - 1) {
      // Numérateur = Σx² - (Σx)² / N. Clamp à 0 contre les erreurs flottantes.
      let variance = (sumSq - (sum * sum) / length) / denom;
      if (variance < 0) variance = 0;
      out[i] = Math.sqrt(variance);
    }
  }
  return out;
}

/**
 * Plus haut roulant sur `length` valeurs.
 * Les `length - 1` premières positions valent `undefined`.
 */
export function rollingHighest(
  values: number[],
  length: number
): Array<number | undefined> {
  length = Math.round(length); // fenêtre entière obligatoire (voir sma)
  const n = values.length;
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  if (length <= 0) return out;

  for (let i = length - 1; i < n; i++) {
    let hi = -Infinity;
    for (let j = i - length + 1; j <= i; j++) {
      const v = values[j];
      if (v !== undefined && v > hi) hi = v;
    }
    out[i] = hi;
  }
  return out;
}

/**
 * Plus bas roulant sur `length` valeurs.
 * Les `length - 1` premières positions valent `undefined`.
 */
export function rollingLowest(
  values: number[],
  length: number
): Array<number | undefined> {
  length = Math.round(length); // fenêtre entière obligatoire (voir sma)
  const n = values.length;
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  if (length <= 0) return out;

  for (let i = length - 1; i < n; i++) {
    let lo = Infinity;
    for (let j = i - length + 1; j <= i; j++) {
      const v = values[j];
      if (v !== undefined && v < lo) lo = v;
    }
    out[i] = lo;
  }
  return out;
}

/** Extrait la série des plus hauts d'un tableau de bougies. */
export function highOf(c: Candle[]): number[] {
  return c.map((b) => b.high);
}

/** Extrait la série des plus bas d'un tableau de bougies. */
export function lowOf(c: Candle[]): number[] {
  return c.map((b) => b.low);
}

/** Extrait la série des volumes (en base) d'un tableau de bougies. */
export function volOf(c: Candle[]): number[] {
  return c.map((b) => b.volume);
}

/**
 * Moyenne mobile pondérée linéairement (WMA) sur `length` valeurs.
 * Les poids vont de 1 (la plus ancienne de la fenêtre) à `length` (la plus
 * récente) ; le résultat est Σ(poids × valeur) / Σ(poids), avec
 * Σ(poids) = length × (length + 1) / 2.
 * Les `length - 1` premières positions valent `undefined`.
 */
export function wma(values: number[], length: number): Array<number | undefined> {
  length = Math.round(length); // fenêtre entière obligatoire (voir sma)
  const n = values.length;
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  if (length <= 0 || n < length) return out;

  const weightSum = (length * (length + 1)) / 2;
  for (let i = length - 1; i < n; i++) {
    let acc = 0;
    // j parcourt la fenêtre ; poids = position relative + 1 (la plus récente = length).
    for (let w = 0; w < length; w++) {
      const v = values[i - length + 1 + w];
      if (v !== undefined) acc += v * (w + 1);
    }
    out[i] = acc / weightSum;
  }
  return out;
}

/**
 * True Range (TR) d'un tableau de bougies.
 * TR[i] = max(high - low, |high - closePrev|, |low - closePrev|).
 * TR[0] = high - low (pas de clôture précédente).
 * Sortie de même longueur que l'entrée (aucun `undefined` : TR est défini dès la
 * première bougie).
 */
export function trueRange(candles: Candle[]): number[] {
  const n = candles.length;
  const out: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const c = candles[i];
    if (c === undefined) continue;
    if (i === 0) {
      out[i] = c.high - c.low;
      continue;
    }
    const prev = candles[i - 1];
    if (prev === undefined) {
      out[i] = c.high - c.low;
      continue;
    }
    const hl = c.high - c.low;
    const hc = Math.abs(c.high - prev.close);
    const lc = Math.abs(c.low - prev.close);
    out[i] = Math.max(hl, hc, lc);
  }
  return out;
}

/**
 * Différence roulante : out[i] = values[i] - values[i - n].
 * `n` vaut 1 par défaut. Les `n` premières positions valent `undefined`, ainsi
 * que toute position dont l'une des deux valeurs comparées est `undefined`.
 */
export function change(
  values: Array<number | undefined>,
  n: number = 1
): Array<number | undefined> {
  n = Math.round(n); // fenêtre entière obligatoire (voir sma) — 9e helper, ex. momentum.ts
  const len = values.length;
  const out: Array<number | undefined> = new Array(len).fill(undefined);
  if (n <= 0) return out;

  for (let i = n; i < len; i++) {
    const cur = values[i];
    const prev = values[i - n];
    if (cur !== undefined && prev !== undefined) out[i] = cur - prev;
  }
  return out;
}

/**
 * Somme roulante sur `length` valeurs.
 * Les `length - 1` premières positions valent `undefined`.
 */
export function rollingSum(
  values: number[],
  length: number
): Array<number | undefined> {
  length = Math.round(length); // fenêtre entière obligatoire (voir sma)
  const n = values.length;
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  if (length <= 0) return out;

  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v !== undefined) sum += v;
    if (i >= length) {
      const old = values[i - length];
      if (old !== undefined) sum -= old;
    }
    if (i >= length - 1) out[i] = sum;
  }
  return out;
}

/**
 * NB conventions de quantification (non unifiées, coexistence assumée) : les
 * helpers de fenêtre ci-dessus (et les quantifications locales ajoutées dans les
 * defs à indexation directe, ex. kama/fisher/roc) arrondissent au plus proche
 * (`Math.round`) ; plusieurs defs plus anciennes (ex. `randomWalk`,
 * `efficiencyRatio`, `linreg`, `smi`) quantifient déjà en amont via
 * `Math.floor`, et `clampInt` ci-dessous fait de même. Les deux conventions
 * cohabitent sans être unifiées (hors périmètre de ce correctif).
 */

/** Borne un entier de paramètre dans [min, max], repli sur `def` si non fini. */
export function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/**
 * Rendements log d'une série de prix, alignés sur les bougies.
 * out[i] = ln(v[i]/v[i-1]) si v[i] et v[i-1] sont finis et > 0 ; sinon undefined
 * (out[0] toujours undefined : pas de borne précédente).
 */
export function rendementsLog(
  values: Array<number | undefined>,
  n: number
): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  for (let i = 1; i < n; i++) {
    const cur = values[i];
    const prev = values[i - 1];
    if (cur === undefined || prev === undefined) continue;
    if (!Number.isFinite(cur) || !Number.isFinite(prev)) continue;
    if (cur <= 0 || prev <= 0) continue;
    out[i] = Math.log(cur / prev);
  }
  return out;
}
