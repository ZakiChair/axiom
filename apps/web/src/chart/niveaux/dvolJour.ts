/**
 * DVOL Deribit quotidien pour les bandes implicites du chart maître (chunk paresseux).
 *
 * La bougie stampée J 00:00 couvre le jour J : sa clôture est le DVOL observé à 00:00 de J+1,
 * c'est-à-dire à l'ancre de la bande du lendemain ; la bougie du jour porte la valeur courante.
 * Chargeur dédié plutôt que `histDvol` (data/referentiels.ts) : son mémo d'une heure servirait,
 * juste après minuit, une série téléchargée avant minuit dont la bougie de la veille n'est pas
 * encore close. Ici : une requête par jour UTC et par devise, promesses en vol partagées ; un
 * échec n'est pas mis en cache, ni une série sans la bougie de la veille (redemandée au prochain
 * essai). Une série non alignée sur 00:00 UTC est refusée.
 */
import { utcDayOf } from "@axiom/indicators";
import { fetchDvolHistory } from "../../data/deribit";
import type { DeviseDeribit } from "../../data/chaineOptionsCache";

const JOUR_MS = 86_400_000;
/** Couvre la clôture du dimanche précédent (au plus 8 jours avant) avec marge. */
export const JOURS_DVOL = 14;

/** Bougie DVOL quotidienne : début du jour UTC (ms) et clôture (%). */
export interface PointDvol {
  time: number;
  value: number;
}

const cache = new Map<string, Promise<PointDvol[] | null>>();

export function chargerDvolJour(
  devise: DeviseDeribit,
  nowMs: number,
  fetcher: (devise: DeviseDeribit, jours: number) => Promise<PointDvol[]> = fetchDvolHistory,
): Promise<PointDvol[] | null> {
  const auj = utcDayOf(nowMs);
  const cle = `${devise}|${auj}`;
  const existante = cache.get(cle);
  if (existante !== undefined) return existante;
  for (const k of cache.keys()) if (!k.endsWith(`|${auj}`)) cache.delete(k);
  const promesse = Promise.resolve()
    .then(() => fetcher(devise, JOURS_DVOL))
    .then((points) => (points.length > 0 && points.every((p) => p.time % JOUR_MS === 0) ? points : null))
    .catch(() => null)
    .then((points) => {
      if (points === null || !points.some((p) => p.time === (auj - 1) * JOUR_MS)) cache.delete(cle);
      return points;
    });
  cache.set(cle, promesse);
  return promesse;
}

export function _viderCacheDvolJour(): void {
  cache.clear();
}
