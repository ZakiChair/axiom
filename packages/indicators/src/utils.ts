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
