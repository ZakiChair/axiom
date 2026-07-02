/**
 * Cache partagé des sources ON-CHAIN (données LENTES : daily / horaire).
 *
 * Les métriques on-chain (Coin Metrics, BGeometrics, mempool…) changent au plus une
 * fois par jour et certaines sont fortement rate-limitées (BGeometrics : 15 req/JOUR).
 * On persiste donc chaque réponse localement et, si le daemon est présent, en KV
 * DURABLE (survit au vidage du cache navigateur). Aucune de ces écritures n'est sur
 * le chemin chaud du renderer (BUILD-CONTRACT) : purement du stockage à froid.
 *
 * Modèle : chaque entrée est enveloppée avec son horodatage d'écriture (`ts`). Le
 * caller décide de la FRAÎCHEUR via `estFrais(entree, ttlMs)` — ce qui permet aussi
 * de RESERVIR une entrée périmée (dégradation gracieuse) en l'étiquetant « périmé »
 * quand la source est momentanément injoignable.
 */
import { daemonPret, kvGet, kvPut } from "../daemon";

/** Namespace KV daemon + préfixe localStorage des entrées on-chain. */
const NS = "onchain";
const PREFIXE_LS = "axiom:onchain:";

/** Entrée de cache : la donnée + son horodatage d'écriture (ms epoch). */
export interface CacheEntree<T> {
  donnee: T;
  ts: number;
}

/** Une entrée est-elle encore fraîche pour la TTL donnée ? */
export function estFrais(entree: CacheEntree<unknown> | null, ttlMs: number): boolean {
  return entree !== null && Date.now() - entree.ts < ttlMs;
}

/** Garde de forme : l'objet ressemble-t-il à une CacheEntree ? */
function estEnveloppe(x: unknown): x is CacheEntree<unknown> {
  return (
    typeof x === "object" &&
    x !== null &&
    "donnee" in x &&
    "ts" in x &&
    typeof (x as { ts: unknown }).ts === "number"
  );
}

/**
 * Lit l'entrée de cache (fraîche OU périmée) : localStorage d'abord (synchrone,
 * rapide), puis KV daemon en repli si absente en local. Renvoie `null` si rien.
 * Ne juge PAS la fraîcheur (à la charge du caller via `estFrais`).
 */
export async function lireCache<T>(cle: string): Promise<CacheEntree<T> | null> {
  // 1) localStorage (best-effort, mode privé toléré).
  try {
    const brut = localStorage.getItem(PREFIXE_LS + cle);
    if (brut !== null) {
      const parse = JSON.parse(brut) as unknown;
      if (estEnveloppe(parse)) return parse as CacheEntree<T>;
    }
  } catch {
    /* accès localStorage refusé ou JSON corrompu → on tente le daemon */
  }

  // 2) KV daemon (uniquement s'il a déjà été détecté — pas de sonde réseau ici).
  if (daemonPret()) {
    const val = await kvGet(NS, cle);
    if (estEnveloppe(val)) {
      const entree = val as CacheEntree<T>;
      // Réamorce le cache local pour les prochaines lectures synchrones.
      try {
        localStorage.setItem(PREFIXE_LS + cle, JSON.stringify(entree));
      } catch {
        /* best-effort */
      }
      return entree;
    }
  }
  return null;
}

/**
 * Écrit une entrée de cache (localStorage + dual-write daemon si présent). L'écriture
 * daemon est « fire-and-forget » (échec silencieux) : ne bloque jamais l'appelant.
 */
export async function ecrireCache<T>(cle: string, donnee: T): Promise<void> {
  const entree: CacheEntree<T> = { donnee, ts: Date.now() };
  try {
    localStorage.setItem(PREFIXE_LS + cle, JSON.stringify(entree));
  } catch {
    /* best-effort : la persistance n'est pas bloquante */
  }
  if (daemonPret()) void kvPut(NS, cle, entree);
}
