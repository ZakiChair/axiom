/**
 * Helper front du proxy générique /extapi (Phase 3).
 *
 * Beaucoup d'APIs de la Phase 3 (RSS news, calendriers éco, on-chain, Deribit,
 * Binance fapi/dapi…) n'ont PAS d'en-tête CORS : un appel direct depuis le
 * navigateur est bloqué. On les route en SAME-ORIGIN via un proxy générique
 * `/extapi/<hote>/<chemin…>` → `https://<hote>/<chemin…>` :
 *   - en DEV  : le proxy de Vite (vite.config.ts) réécrit (une entrée par hôte) ;
 *   - en PROD : le daemon `axiomd` réécrit ET met en cache (TTL 120 s / 30 s dérivés).
 * Une URL RELATIVE suffit dans les deux cas (même origine que le front) — comme
 * les proxys /fredapi… existants. Le front reste donc fonctionnel SANS daemon en dev.
 *
 * Whitelist : source unique `shared/extapi-hosts.ts` (daemon + Vite + ce module).
 */

import { EXTAPI_HOSTS } from "../../../../shared/extapi-hosts";

/** Hôtes autorisés par le proxy /extapi. */
export const EXTAPI_WHITELIST: readonly string[] = EXTAPI_HOSTS;

/** L'hôte est-il autorisé par le proxy /extapi ? (garde-fou dev côté appelant). */
export function estHoteExtapiAutorise(hote: string): boolean {
  return EXTAPI_WHITELIST.includes(hote);
}

/**
 * Construit l'URL relative same-origin `/extapi/<hote>/<chemin>`.
 * `chemin` peut inclure un query string (`fng/?limit=10`) — passé tel quel (le
 * caller construit son query via URLSearchParams si besoin). Un `/` en tête de
 * `chemin` est absorbé pour éviter un double slash.
 *
 * NB : ne valide PAS l'hôte (le daemon renvoie 403 si hors whitelist) — utiliser
 * `estHoteExtapiAutorise` en amont si un garde-fou explicite est souhaité.
 */
export function extUrl(hote: string, chemin: string): string {
  const cheminNettoye = chemin.startsWith("/") ? chemin.slice(1) : chemin;
  return `/extapi/${hote}/${cheminNettoye}`;
}
