/**
 * Fenêtre LIQ — calculs PURS sur le buffer d'événements du singleton
 * (`liqEventsStore`, cf. chart/liquidationMarkers.ts) : filtre de fenêtre glissante,
 * stats agrégées (totaux long/short, dominance, max, répartition par venue), buckets
 * temporels du mini-histogramme et magnitude log des lignes du feed.
 * Aucun accès store/DOM : tout est injecté (events, bornes de temps), tout est testé.
 */
import type { LiqEvent } from "../chart/liquidationMarkers";

/** Ne garde que les événements de la fenêtre glissante (time ≥ depuisMs). PURE. */
export function filtrerFenetre(events: LiqEvent[], depuisMs: number): LiqEvent[] {
  return events.filter((ev) => ev.time >= depuisMs);
}

/** Stats agrégées d'un lot d'événements (fenêtre glissante de la fenêtre LIQ). */
export interface StatsLiquidations {
  longUsd: number;
  shortUsd: number;
  total: number;
  /** Part des liquidations LONGUES dans le notionnel total (0..1), ou null si vide. */
  partLong: number | null;
  /** Nombre d'événements. */
  nb: number;
  /** Plus grosse liquidation individuelle (USD). */
  maxUsd: number;
  /** Répartition par venue (bybit, okx…) : notionnel + nombre. */
  parVenue: Record<string, { usd: number; nb: number }>;
}

/** Agrège totaux long/short, dominance, nb, max et répartition par venue. PURE. */
export function statsLiquidations(events: LiqEvent[]): StatsLiquidations {
  let longUsd = 0;
  let shortUsd = 0;
  let maxUsd = 0;
  const parVenue: Record<string, { usd: number; nb: number }> = {};
  for (const ev of events) {
    if (ev.side === "long") longUsd += ev.usd;
    else shortUsd += ev.usd;
    if (ev.usd > maxUsd) maxUsd = ev.usd;
    let v = parVenue[ev.venue];
    if (v === undefined) {
      v = { usd: 0, nb: 0 };
      parVenue[ev.venue] = v;
    }
    v.usd += ev.usd;
    v.nb += 1;
  }
  const total = longUsd + shortUsd;
  return {
    longUsd,
    shortUsd,
    total,
    partLong: total > 0 ? longUsd / total : null,
    nb: events.length,
    maxUsd,
    parVenue,
  };
}

/** Un bucket temporel du mini-histogramme (t = début du bucket). */
export interface BucketTemporel {
  t: number;
  longUsd: number;
  shortUsd: number;
}

/**
 * Répartit les événements de [depuisMs, nowMs] dans `nBuckets` buckets temporels
 * réguliers (les événements hors fenêtre sont écartés ; time = nowMs va dans le
 * dernier bucket). Renvoie [] si les paramètres sont dégénérés. PURE.
 */
export function bucketsTemporels(
  events: LiqEvent[],
  depuisMs: number,
  nowMs: number,
  nBuckets: number,
): BucketTemporel[] {
  if (!(nBuckets >= 1) || !(nowMs > depuisMs)) return [];
  const pas = (nowMs - depuisMs) / nBuckets;
  const out: BucketTemporel[] = [];
  for (let i = 0; i < nBuckets; i++) {
    out.push({ t: depuisMs + i * pas, longUsd: 0, shortUsd: 0 });
  }
  for (const ev of events) {
    if (ev.time < depuisMs || ev.time > nowMs) continue;
    const b = out[Math.min(nBuckets - 1, Math.floor((ev.time - depuisMs) / pas))];
    if (b === undefined) continue;
    if (ev.side === "long") b.longUsd += ev.usd;
    else b.shortUsd += ev.usd;
  }
  return out;
}

/**
 * Magnitude log-normalisée ∈ [0,1] d'une liquidation face au max de la fenêtre
 * (`log1p(usd)/log1p(maxUsd)`, clampée — même échelle que la heatmap) : pilote la
 * largeur de la barre de fond des lignes du feed. Renvoie 0 si maxUsd ≤ 0. PURE.
 */
export function magnitudeRelative(usd: number, maxUsd: number): number {
  if (!(maxUsd > 0)) return 0;
  const t = Math.log1p(Math.max(0, usd)) / Math.log1p(maxUsd);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
