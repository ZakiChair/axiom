/**
 * Fusion de resync post-reconnexion (flux kline). Logique PURE & testée.
 *
 * Après une coupure WS, l'adaptateur re-fetche un lot récent de bougies REST puis
 * on le fond dans le buffer courant :
 *  - les bougies re-fetchées PRIMENT à open time égal (elles portent l'état
 *    clôturé/finalisé et comblent les trous des bougies manquées pendant la coupure) ;
 *  - l'unique bougie en cours (la plus récente) peut être momentanément ramenée à
 *    l'instantané REST : le prochain tick live la corrige.
 *
 * Dédup par open time, tri ascendant (invariant attendu par le buffer marché et par
 * KLineChart). Ne dépend d'aucun état externe : robuste face à la course entre le
 * fetch REST et les ticks live qui continuent d'arriver pendant la reconnexion.
 */
import type { Candle } from "@axiom/types";

export function mergeResyncCandles(existing: Candle[], fetched: Candle[]): Candle[] {
  const parTemps = new Map<number, Candle>();
  for (const c of existing) parTemps.set(c.time, c);
  for (const c of fetched) parTemps.set(c.time, c); // le REST prime à open time égal
  return [...parTemps.values()].sort((a, b) => a.time - b.time);
}

/**
 * Décide d'appliquer un lot REST de resync et prépare le buffer fusionné.
 *
 * Règle unique : appliquer si et seulement si `fetched.length > 0`.
 * Intentionnellement indépendant de `existing.length` / de la longueur du merge —
 * un lot REST peut corriger buy/sell/closed à open times déjà présents sans
 * changer la cardinalité ; le CVD doit alors être reseedé (orderflow.onCandles).
 *
 * Ne PAS réintroduire d'early-return du type `merged.length === existing.length`.
 *
 * @returns le buffer fusionné à appliquer, ou `null` si rien à faire (lot vide).
 */
export function prepareResyncApply(
  existing: Candle[],
  fetched: Candle[],
): Candle[] | null {
  if (fetched.length === 0) return null;
  // Toujours merger et appliquer — même si la longueur ne change pas.
  return mergeResyncCandles(existing, fetched);
}
