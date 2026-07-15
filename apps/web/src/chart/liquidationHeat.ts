/**
 * Grille 2D pure des liquidations : agrège les événements bruts (`LiqEvent`, Tâche 4) en
 * cellules (une BOUGIE × un BUCKET de prix) sur la plage visible, en séparant long/short.
 * C'est le moteur d'agrégation qui alimentera le contrôleur canvas de la heatmap (Tâche 6).
 *
 * Modèle : les événements sont conservés bruts ; le re-bucketing est gratuit, donc la taille
 * de bucket est RECALCULÉE à chaque construction depuis le close de la dernière bougie de la
 * plage (plus de taille figée). L'échelle d'intensité est LOGARITHMIQUE (log1p) pour relever
 * les petits niveaux face aux cascades massives.
 *
 * Toutes les fonctions ici sont PURES (aucun accès DOM/store/chart) et testées.
 */
import type { Candle } from "@axiom/types";
import { tailleBucket, bucketIndex, candleContenant, type LiqEvent } from "./liquidationMarkers";

/** Cellule agrégée : une bougie × un bucket de prix. */
export interface LiqCell {
  candleTime: number;
  bucketIdx: number;
  longUsd: number;
  shortUsd: number;
  count: number;
}

/** Grille complète : cellules indexées par `${candleTime}:${bucketIdx}` + méta. */
export interface LiqGrid {
  cells: Map<string, LiqCell>;
  taille: number;
  maxUsd: number; // max(longUsd + shortUsd) sur les cellules
}

/**
 * Agrège les `events` en cellules (bougie × bucket) sur la plage de bougies [from, to)
 * (INDEX de bougies, convention `getVisibleRange`). La taille de bucket est dérivée du close
 * de la DERNIÈRE bougie de la plage ; chaque événement est rattaché à sa bougie contenante
 * (`candleContenant`), et les événements hors de [candles[from].time, candles[to-1].time]
 * sont écartés. Renvoie `null` si la plage contient < 1 bougie ou ne produit aucune cellule.
 * PURE.
 */
export function construireGrille(
  events: LiqEvent[],
  candles: Candle[],
  from: number,
  to: number,
): LiqGrid | null {
  if (to - from < 1) return null;
  const premier = candles[from];
  const dernier = candles[to - 1];
  if (premier === undefined || dernier === undefined) return null;

  const taille = tailleBucket(dernier.close);
  if (!(taille > 0)) return null;

  const cells = new Map<string, LiqCell>();
  for (const ev of events) {
    if (!(ev.price > 0) || !Number.isFinite(ev.usd)) continue;
    const c = candleContenant(candles, ev.time);
    if (c === undefined) continue;
    // Rattachement borné à la plage visible : les temps de bougie sont croissants, donc
    // c.time ∈ [premier.time, dernier.time] ⇔ index de la bougie ∈ [from, to).
    if (c.time < premier.time || c.time > dernier.time) continue;

    const bucketIdx = bucketIndex(ev.price, taille);
    const cle = `${c.time}:${bucketIdx}`;
    let cell = cells.get(cle);
    if (cell === undefined) {
      cell = { candleTime: c.time, bucketIdx, longUsd: 0, shortUsd: 0, count: 0 };
      cells.set(cle, cell);
    }
    if (ev.side === "long") cell.longUsd += ev.usd;
    else cell.shortUsd += ev.usd;
    cell.count += 1;
  }

  if (cells.size === 0) return null;

  let maxUsd = 0;
  for (const cell of cells.values()) {
    const total = cell.longUsd + cell.shortUsd;
    if (total > maxUsd) maxUsd = total;
  }

  return { cells, taille, maxUsd };
}

/**
 * Intensité log-normalisée ∈ [0,1] : `log1p(usd) / log1p(maxUsd)`, clampée. La log relève
 * les petits niveaux face aux cascades massives. Renvoie 0 si `maxUsd <= 0`. PURE.
 */
export function intensiteLog(usd: number, maxUsd: number): number {
  if (!(maxUsd > 0)) return 0;
  const t = Math.log1p(Math.max(0, usd)) / Math.log1p(maxUsd);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Profil latéral par bucket de prix : somme long/short de toutes les bougies pour chaque
 * bucketIdx (alimente les bandes du bord droit). PURE.
 */
export function profilParPrix(grid: LiqGrid): Map<number, { longUsd: number; shortUsd: number }> {
  const profil = new Map<number, { longUsd: number; shortUsd: number }>();
  for (const cell of grid.cells.values()) {
    let agg = profil.get(cell.bucketIdx);
    if (agg === undefined) {
      agg = { longUsd: 0, shortUsd: 0 };
      profil.set(cell.bucketIdx, agg);
    }
    agg.longUsd += cell.longUsd;
    agg.shortUsd += cell.shortUsd;
  }
  return profil;
}
