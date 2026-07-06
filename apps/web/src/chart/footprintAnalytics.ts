/**
 * Analyse footprint pro — détection d'imbalances, stacked et divergences delta.
 *
 * Modules complémentaires du footprint standard (M5) :
 *  - Imbalances (à l'échelle d'un niveau de prix, pas d'une bougie).
 *  - Divergences delta (entre bougies consécutives).
 *
 * Convention d'imbalance (footprint standard) :
 *  - ask imbalance au niveau i = `buyVol[i] ≥ (ratioPct/100) × sellVol[i-1]`
 *    (diagonale : agression acheteuse au niveau i vs passif vendeur un tick en dessous),
 *    avec `buyVol[i] ≥ minVol`. Si `sellVol[i-1] === 0`, imbalance ssi
 *    `buyVol[i] ≥ minVol && buyVol[i] > 0`.
 *  - bid imbalance symétrique : `sellVol[i] ≥ (ratioPct/100) × buyVol[i+1]`.
 *  - stacked = membre d'une suite de ≥ 3 imbalances consécutives du même côté.
 *
 * Convention de divergence delta :
 *  - `bear` si `high > high précédent && delta < 0`
 *  - `bull` si `low < low précédent && delta > 0`
 *  - `null` sinon (et pour la première bougie).
 *
 * Les résultats sont indexés sur `rows` (triés par prix croissant) et `bars` (triés
 * par time croissant). Zéro re-render React — tout est calculé au rendu du contrôleur.
 */
import type { Candle, FootprintBar, FootprintRow } from "@axiom/types";

// ───────────────────────────── Types publics ─────────────────────────────

export interface ImbalanceFlags {
  askImb: boolean[];       // imbalance acheteuse à chaque niveau
  bidImb: boolean[];       // imbalance vendeuse à chaque niveau
  stackedAsk: boolean[];   // stacked ask (≥ 3 consécutives)
  stackedBid: boolean[];   // stacked bid
}

export type DivergenceFlag = "bull" | "bear" | null;

// ───────────────────────────── Détection imbalances ─────────────────────

/**
 * Détecte les imbalances et stacks dans les rows d'un footprint.
 *
 * @param rows — rows du footprint (triées par prix croissant)
 * @param ratioPct — seuil en % (ex. 300 → ratio 3×)
 * @param minVol — volume minimum pour qu'une imbalance soit validée
 */
export function detectImbalances(
  rows: FootprintRow[],
  ratioPct: number,
  minVol: number
): ImbalanceFlags {
  const askImb: boolean[] = new Array(rows.length);
  const bidImb: boolean[] = new Array(rows.length);
  const stackedAsk: boolean[] = new Array(rows.length);
  const stackedBid: boolean[] = new Array(rows.length);

  // ── Pass 1 : flags bruts ──
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r === undefined) continue;

    // Ask imbalance : diagonale buyVol[i] vs sellVol[i-1]
    if (i === 0) {
      askImb[i] = false;
    } else {
      const prev = rows[i - 1];
      if (prev === undefined) {
        askImb[i] = false;
      } else {
        askImb[i] =
          r.buyVol >= minVol &&
          r.buyVol > 0 &&
          (prev.sellVol === 0
            ? true
            : r.buyVol >= (ratioPct / 100) * prev.sellVol);
      }
    }

    // Bid imbalance : diagonale sellVol[i] vs buyVol[i+1]
    if (i === rows.length - 1) {
      bidImb[i] = false;
    } else {
      const next = rows[i + 1];
      if (next === undefined) {
        bidImb[i] = false;
      } else {
        bidImb[i] =
          r.sellVol >= minVol &&
          r.sellVol > 0 &&
          (next.buyVol === 0
            ? true
            : r.sellVol >= (ratioPct / 100) * next.buyVol);
      }
    }
  }

  // ── Pass 2 : stacks (suites de ≥ 3 imbalances consécutives du même côté) ──
  for (let i = 0; i < rows.length; i++) {
    if (i < 1 || i >= rows.length - 1) {
      stackedAsk[i] = false;
      stackedBid[i] = false;
      continue;
    }
    const prev = rows[i - 1];
    const next = rows[i + 1];
    if (prev === undefined || next === undefined) {
      stackedAsk[i] = false;
      stackedBid[i] = false;
      continue;
    }
    // Ask stacked : i, i-1, i+1 tous askImb
    stackedAsk[i] = askImb[i] && askImb[i - 1] && askImb[i + 1];
    stackedBid[i] = bidImb[i] && bidImb[i - 1] && bidImb[i + 1];
  }

  return { askImb, bidImb, stackedAsk, stackedBid };
}

// ───────────────────────────── Détection divergences delta ─────────────────────

/**
 * Détecte les divergences bullish/bearish delta sur une séquence de bougies.
 *
 * @param candles — bougies OHLCV (alignées chronologiquement)
 * @param bars — bars footprint (alignés sur candles par time)
 * @returns array de DivergenceFlag, indexée sur bars
 */
export function detectDeltaDivergences(
  candles: Candle[],
  bars: FootprintBar[]
): DivergenceFlag[] {
  // Cas limites : tableaux vides → résultat vide
  if (bars.length === 0 || candles.length === 0) return [];
  if (bars.length === 1) return [null];

  const out: DivergenceFlag[] = new Array(bars.length);
  out[0] = null;

  let lastDivergence: DivergenceFlag = null; // streak : ne garde que la première

  for (let i = 1; i < bars.length; i++) {
    const candle = candles[i];
    const prevCandle = candles[i - 1];
    if (candle === undefined || prevCandle === undefined) {
      out[i] = null;
      continue;
    }

    const bar = bars[i];
    const prevBar = bars[i - 1];
    if (bar === undefined || prevBar === undefined) {
      out[i] = null;
      continue;
    }

    const isBear = candle.high > prevCandle.high && bar.delta < 0;
    const isBull = candle.low < prevCandle.low && bar.delta > 0;

    if (isBear) {
      out[i] = lastDivergence === null ? "bear" : null;
      lastDivergence = "bear";
    } else if (isBull) {
      out[i] = lastDivergence === null ? "bull" : null;
      lastDivergence = "bull";
    } else {
      out[i] = null;
    }
  }

  return out;
}
