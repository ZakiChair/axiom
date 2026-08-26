/**
 * Helper front du proxy générique /extapi (Phase 3).
 *
 * Les APIs sans CORS passent en SAME-ORIGIN par `/extapi/<hote>/<chemin…>` : Vite en
 * dev, axiomd en prod locale, fonction serverless sur Vercel. Exception : Binance fapi
 * est appelé directement sur Vercel (CORS public), car ses IP serverless répondent 451.
 *
 * Whitelist : source unique `shared/extapi-hosts.ts` (daemon + Vite + ce module).
 */

import { EXTAPI_HOSTS } from "../../../../shared/extapi-hosts";
import { IS_VERCEL } from "../lib/deployment";

/** Hôtes autorisés par le proxy /extapi. */
export const EXTAPI_WHITELIST: readonly string[] = EXTAPI_HOSTS;

/** L'hôte est-il autorisé par le proxy /extapi ? (garde-fou dev côté appelant). */
export function estHoteExtapiAutorise(hote: string): boolean {
  return EXTAPI_WHITELIST.includes(hote);
}

/**
 * Construit l'URL `/extapi/<hote>/<chemin>`, ou l'URL fapi directe sur Vercel.
 * `chemin` peut inclure un query string (`fng/?limit=10`) — passé tel quel (le
 * caller construit son query via URLSearchParams si besoin). Un `/` en tête de
 * `chemin` est absorbé pour éviter un double slash.
 *
 * NB : ne valide PAS l'hôte (le daemon renvoie 403 si hors whitelist) — utiliser
 * `estHoteExtapiAutorise` en amont si un garde-fou explicite est souhaité.
 */
export function extUrlPourDeployment(
  hote: string,
  chemin: string,
  isVercel: boolean,
): string {
  const cheminNettoye = chemin.startsWith("/") ? chemin.slice(1) : chemin;
  if (isVercel && hote === "fapi.binance.com") return `https://${hote}/${cheminNettoye}`;
  return `/extapi/${hote}/${cheminNettoye}`;
}

export function extUrl(hote: string, chemin: string): string {
  return extUrlPourDeployment(hote, chemin, IS_VERCEL);
}
