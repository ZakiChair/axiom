/**
 * Bougies 1d UTC du slot pour les niveaux clés (chunk paresseux).
 *
 * Semaine, mois et trimestre sont TOUJOURS dérivés de ces bougies quotidiennes : Coinbase
 * n'expose ni 1w ni 1M, Kraken pas de 1M (vérifié par la recherche). Une requête par jour UTC
 * et par (source, symbole), promesses en vol partagées ; un échec n'est pas mis en cache.
 * Une série dont les bougies n'ouvrent pas à 00:00 UTC est refusée : ses « jours » ne sont pas
 * les jours UTC des niveaux, le résultat serait faux sans le dire.
 */
import type { Candle, ExchangeId } from "@axiom/types";
import { utcDayOf } from "@axiom/indicators";
import { getAdapter, supportedTimeframesFor } from "../../data/adapters";

const JOUR_MS = 86_400_000;
/** ≥ 92 jours (ouverture du trimestre) + mois précédent + jour courant ; sûr sur toutes les sources. */
export const LIMITE_BOUGIES_JOUR = 100;

export interface DepsBougiesJour {
  getAdapter: typeof getAdapter;
  supportedTimeframesFor: typeof supportedTimeframesFor;
}

const DEPS: DepsBougiesJour = { getAdapter, supportedTimeframesFor };

export function estAligneUtc(bougies: readonly Candle[]): boolean {
  return bougies.every((b) => b.time % JOUR_MS === 0);
}

export function msAvantProchainJourUtc(nowMs: number): number {
  return (utcDayOf(nowMs) + 1) * JOUR_MS - nowMs;
}

/** La source sait-elle servir des bougies 1d pour ce symbole ? (séries synthétiques exclues) */
export function bougiesJourDisponibles(exchange: ExchangeId, symbol: string, deps: DepsBougiesJour = DEPS): boolean {
  return exchange !== "synthetic" && deps.supportedTimeframesFor(exchange, symbol).includes("1d");
}

const cache = new Map<string, Promise<Candle[] | null>>();

export function chargerBougiesJour(
  exchange: ExchangeId,
  symbol: string,
  nowMs: number,
  deps: DepsBougiesJour = DEPS,
): Promise<Candle[] | null> {
  if (!bougiesJourDisponibles(exchange, symbol, deps)) return Promise.resolve(null);
  const jour = `|${utcDayOf(nowMs)}`;
  const cle = `${exchange}|${symbol}${jour}`;
  const existante = cache.get(cle);
  if (existante !== undefined) return existante;
  // Les jours révolus ne servent plus : on ne garde que les entrées du jour courant.
  for (const k of cache.keys()) if (!k.endsWith(jour)) cache.delete(k);
  const promesse = Promise.resolve()
    .then(() => deps.getAdapter(exchange).fetchKlines(symbol, "1d", { limit: LIMITE_BOUGIES_JOUR }))
    .then((bougies) => (bougies.length > 0 && estAligneUtc(bougies) ? bougies : null))
    .catch(() => null)
    .then((bougies) => {
      if (bougies === null) cache.delete(cle);
      return bougies;
    });
  cache.set(cle, promesse);
  return promesse;
}

export function _viderCacheBougiesJour(): void {
  cache.clear();
}
