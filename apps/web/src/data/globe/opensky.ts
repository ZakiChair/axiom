/**
 * OpenSky Network — vecteurs d'état du trafic aérien mondial (globe).
 *
 * GET /api/states/all ANONYME (sans clé) : ~11 000 aéronefs en un appel, fraîcheur
 * ~10 s (cf. docs/research/06-trafic-aerien-globe.md §1, testé en direct 2026-07-10).
 *
 * CORS vérifié en direct : l'API renvoie `access-control-allow-origin:
 * https://opensky-network.org` (origine FIXE) → appel direct navigateur BLOQUÉ, on
 * passe par le proxy same-origin /extapi (whitelist ×3). L'en-tête amont
 * `x-rate-limit-remaining` est visible en DEV (proxy Vite) et retransmis par le
 * daemon en PROD sur cache-miss (absent sur hit — le cache ne stocke que le corps) →
 * `creditsRestants` peut valoir null sur certains cycles (contrat toléré, indicatif).
 *
 * AUCUNE boucle de polling ici : la fenêtre pilote la cadence (INTERVALLE_POLL_MS).
 */
import { extUrl } from "../extapi";
import type { Avion, EtatOpenSky } from "./types";

/**
 * Cadence de polling recommandée pour la fenêtre globe (ms).
 *
 * Budget crédits ANONYME : un appel /states/all GLOBAL coûte 4 crédits, plafond
 * 400 crédits/jour/IP → 100 rafraîchissements globaux/jour maximum. À un appel
 * toutes les 120 s, le budget couvre 100 × 2 min ≈ 3 h 20 d'affichage continu par
 * jour (≈ 2 h utiles en gardant une marge pour les relances/erreurs) — l'UI affiche
 * `creditsRestants` pour rendre ce budget visible. Le TTL du cache /extapi côté
 * daemon est de 90 s (< poll — anti-aliasing : à TTL égal au poll, chaque tick
 * retombait sur un hit et resservait l'instantané précédent, avions figés 4 min).
 */
export const INTERVALLE_POLL_MS = 120_000;

/** Chemin proxifié de l'appel global (hôte whitelisté /extapi). */
const URL_STATES_ALL = extUrl("opensky-network.org", "api/states/all");

/** Coerce en nombre fini, sinon null. */
function nombreOuNull(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

/**
 * Parse le tableau `states` d'OpenSky (indices POSITIONNELS, cf. doc REST officielle
 * reprise dans le rapport 06 et vérifiée sur réponse réelle le 2026-07-10) :
 *   [0] icao24 · [5] longitude · [6] latitude · [7] baro_altitude (m)
 *   [8] on_ground · [10] true_track (°) · [13] geo_altitude (m)
 * Les aéronefs sans position (lat/lon null — fréquent) sont FILTRÉS. Fonction PURE.
 */
export function parseEtatsOpenSky(json: unknown, creditsRestants: number | null): EtatOpenSky | null {
  const o = json as { time?: unknown; states?: unknown } | null;
  const horodatage = nombreOuNull(o?.time);
  if (horodatage === null) return null;

  const avions: Avion[] = [];
  const states = o?.states;
  if (Array.isArray(states)) {
    for (const brut of states) {
      if (!Array.isArray(brut)) continue;
      const s = brut as unknown[];
      const icao24 = s[0];
      const lon = nombreOuNull(s[5]);
      const lat = nombreOuNull(s[6]);
      if (typeof icao24 !== "string" || icao24.length === 0 || lat === null || lon === null) continue;
      avions.push({
        icao24,
        lat,
        lon,
        cap: nombreOuNull(s[10]),
        altitude: nombreOuNull(s[13]) ?? nombreOuNull(s[7]),
        auSol: s[8] === true,
      });
    }
  }
  return { avions, horodatage, creditsRestants };
}

/** Parse l'en-tête `x-rate-limit-remaining` (entier ≥ 0), ou null si absent/invalide. Fonction PURE. */
export function parseCreditsRestants(entete: string | null): number | null {
  if (entete === null) return null;
  const n = Number(entete);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/**
 * Récupère l'instantané mondial /states/all via le proxy /extapi. Dégradation
 * gracieuse : toute erreur (réseau, HTTP, JSON, forme inattendue) → null, jamais
 * d'exception propagée. Pas de cache local : la donnée est périssable (~10 s) et
 * le TTL 120 s du proxy daemon absorbe déjà les rafales.
 */
export async function chargerEtatsAvions(signal?: AbortSignal): Promise<EtatOpenSky | null> {
  try {
    const res = await fetch(URL_STATES_ALL, { signal });
    if (!res.ok) return null;
    const credits = parseCreditsRestants(res.headers.get("x-rate-limit-remaining"));
    return parseEtatsOpenSky((await res.json()) as unknown, credits);
  } catch {
    return null;
  }
}
