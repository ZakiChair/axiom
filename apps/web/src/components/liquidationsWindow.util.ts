/**
 * Fenêtre LIQ — calculs PURS sur le buffer d'événements du singleton
 * (`liqEventsStore`, cf. chart/liquidationMarkers.ts) : filtre de fenêtre glissante,
 * stats agrégées (totaux long/short, dominance, max, répartition par venue), buckets
 * temporels du mini-histogramme, magnitude log des lignes du feed, groupement des
 * cascades du feed, notionnel liquidé par minute glissante (alerte `liq-cascade`),
 * traduction du fil daemon (onglet Historique) et top des plus grosses liquidations.
 * Aucun accès store/DOM : tout est injecté (events, bornes de temps), tout est testé.
 */
import type { LiqEvent } from "../chart/liquidationMarkers";
import type { LiqDaemon } from "../data/daemon";

/** Ne garde que les événements de la fenêtre glissante (time ≥ depuisMs). PURE. */
export function filtrerFenetre(events: LiqEvent[], depuisMs: number): LiqEvent[] {
  return events.filter((ev) => ev.time >= depuisMs);
}

/** Le buffer couvre-t-il TOUTE la fenêtre ? (au moins un événement plus vieux que now − fenetreMs) */
export function couvreFenetre(events: readonly LiqEvent[], fenetreMs: number, now: number): boolean {
  return events.some((ev) => ev.time < now - fenetreMs);
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
 * Traduit le fil de liquidations persistées du daemon (`LiqDaemon`, champ `t`) en
 * événements au format chart (`LiqEvent`, champ `time`) : mêmes valeurs, jamais de flag
 * `approx` (le daemon n'enregistre que des liquidations réelles). PURE.
 */
export function daemonVersEvenements(rows: LiqDaemon[]): LiqEvent[] {
  return rows.map((d) => ({
    time: d.t,
    side: d.side,
    price: d.price,
    qty: d.qty,
    usd: d.usd,
    venue: d.venue,
  }));
}

/**
 * Les `n` plus grosses liquidations d'un lot, triées par notionnel décroissant
 * (l'entrée n'est pas mutée). Renvoie [] si n < 1. PURE.
 */
export function topLiquidations(events: LiqEvent[], n: number): LiqEvent[] {
  if (!(n >= 1)) return [];
  return [...events].sort((a, b) => b.usd - a.usd).slice(0, n);
}

/** Groupe de liquidations consécutives de même côté (cascade) dans le feed. */
export interface GroupeCascade {
  type: "groupe";
  /** Événements du groupe, dans l'ordre du feed (du plus récent au plus ancien). */
  events: LiqEvent[];
  /** Notionnel cumulé du groupe (USD). */
  sommeUsd: number;
  prixMin: number;
  prixMax: number;
  side: "long" | "short";
  /** Venues cumulées, uniques, dans l'ordre d'apparition. */
  venues: string[];
  /** Horodatage du plus ANCIEN événement du groupe (ms). */
  debut: number;
  /** Horodatage du plus RÉCENT événement du groupe (ms). */
  fin: number;
}

/** Item du feed : liquidation isolée ou groupe cascade. */
export type ItemFeed = { type: "seul"; ev: LiqEvent } | GroupeCascade;

/**
 * Fusionne en « cascades » les liquidations CONSÉCUTIVES de MÊME CÔTÉ espacées de
 * moins de `ecartMs` (≥ 2 événements = groupe, sinon ligne isolée). `events` est
 * attendu dans l'ordre du feed (anté-chronologique : du plus récent au plus ancien) ;
 * cet ordre est conservé en sortie, y compris dans `events` de chaque groupe. PURE.
 */
export function grouperCascades(events: LiqEvent[], ecartMs = 2_000): ItemFeed[] {
  const out: ItemFeed[] = [];
  let i = 0;
  while (i < events.length) {
    const premier = events[i];
    if (premier === undefined) break;
    // Étend le run tant que l'événement suivant (plus ancien) est du même côté et
    // espacé de < ecartMs du DERNIER événement du run (écart entre liq adjacentes).
    let dernier = premier;
    let j = i + 1;
    for (; j < events.length; j++) {
      const suivant = events[j];
      if (suivant === undefined) break;
      if (suivant.side !== premier.side || dernier.time - suivant.time >= ecartMs) break;
      dernier = suivant;
    }
    const run = events.slice(i, j);
    if (run.length >= 2) {
      let sommeUsd = 0;
      let prixMin = Infinity;
      let prixMax = -Infinity;
      const venues: string[] = [];
      for (const e of run) {
        sommeUsd += e.usd;
        if (e.price < prixMin) prixMin = e.price;
        if (e.price > prixMax) prixMax = e.price;
        if (!venues.includes(e.venue)) venues.push(e.venue);
      }
      out.push({
        type: "groupe",
        events: run,
        sommeUsd,
        prixMin,
        prixMax,
        side: premier.side,
        venues,
        debut: dernier.time,
        fin: premier.time,
      });
    } else {
      out.push({ type: "seul", ev: premier });
    }
    i = j;
  }
  return out;
}

/**
 * Notionnel liquidé (USD, tous côtés) sur la dernière minute glissante : somme des
 * `usd` des événements à time ≥ nowMs − 60 000 (borne incluse). Alimente le contexte
 * `liqUsdParMin` de l'alerte `liq-cascade` (cf. alerts/runtime.ts). PURE.
 */
export function usdParMinute(events: LiqEvent[], nowMs: number): number {
  const depuis = nowMs - 60_000;
  let total = 0;
  for (const ev of events) {
    if (ev.time >= depuis) total += ev.usd;
  }
  return total;
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
