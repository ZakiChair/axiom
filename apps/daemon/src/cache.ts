/**
 * Cache TTL des réponses GET proxifiées (stockage SQLite via db.ts).
 *
 * But : absorber les quotas des APIs à crédits (Coinalyze 40/min, Twelve Data
 * 8/min & ~800/j, FRED). Les données dérivées ont de toute façon ~1 min de
 * latence côté fournisseur → un cache court est transparent pour l'analyse.
 *
 * Les fonctions `ttlMsPourChemin` et `cleCache` sont PURES (testées) et n'ouvrent
 * pas la base ; les fonctions d'accès (`lireCache`…) l'ouvrent paresseusement.
 */
import { getDb } from "./db";

/**
 * TTL par préfixe de route, en SECONDES.
 * Choix documentés (compromis fraîcheur / quota) :
 *  - /fredapi      : 3600 s (séries macro très lentes, quota généreux).
 *  - /coinalyzeapi :   30 s (dérivés, quota 40/min → ~1 appel/route/30 s).
 *  - /tdapi        :   60 s (tradfi, quota 8/min & ~800/jour → à ménager).
 *  - /mexcapi      :   10 s (spot temps réel, mais le chemin chaud passe par les
 *                            WS directs du front ; ici on ne sert que du REST ponctuel).
 *  - /ethscanapi   :   60 s (gas/supply/nœuds ETH ; front cache déjà 10 min — ce TTL
 *                            n'absorbe que les rafales. /sosoapi est en POST → jamais
 *                            caché par le daemon, le front cache 6 h en IndexedDB).
 */
export const TTL_SECONDES_PAR_PREFIXE: Readonly<Record<string, number>> = {
  "/fredapi": 3600,
  "/coinalyzeapi": 30,
  "/tdapi": 60,
  "/mexcapi": 10,
  "/ethscanapi": 60,
};

/**
 * TTL (en millisecondes) applicable à un pathname, par correspondance de préfixe.
 * Renvoie 0 si aucun préfixe connu ne matche (→ pas de cache). Fonction PURE.
 */
export function ttlMsPourChemin(pathname: string): number {
  for (const prefixe in TTL_SECONDES_PAR_PREFIXE) {
    if (pathname === prefixe || pathname.startsWith(prefixe + "/")) {
      return (TTL_SECONDES_PAR_PREFIXE[prefixe] as number) * 1000;
    }
  }
  return 0;
}

/** Paramètres de query porteurs d'un secret : leur VALEUR est expurgée de la clé de cache. */
const PARAMS_SECRETS = ["apikey", "api_key"] as const;

/**
 * Clé de cache = `<METHODE> <pathname+search>`, avec les VALEURS des paramètres de
 * clé API remplacées par `***`. Le secret injecté par le proxy n'apparaît jamais ici
 * (ajouté après, au moment du fetch amont) ; une clé PERSONNELLE envoyée par le front
 * en query (ex. `apikey=` Etherscan, `api_key=` FRED/Coinalyze) est expurgée — la
 * PRÉSENCE du paramètre reste encodée pour ne pas confondre une réponse « avec clé »
 * (complète) et « sans clé » (dégradée chez Etherscan) sous la même entrée. Résultat :
 * aucune clé API stockée en clair dans la colonne `cle`. Fonction PURE.
 */
export function cleCache(methode: string, cheminAvecQuery: string): string {
  const posQuery = cheminAvecQuery.indexOf("?");
  if (posQuery === -1) return `${methode} ${cheminAvecQuery}`;
  const params = new URLSearchParams(cheminAvecQuery.slice(posQuery + 1));
  for (const nom of PARAMS_SECRETS) {
    if (params.has(nom)) params.set(nom, "***");
  }
  return `${methode} ${cheminAvecQuery.slice(0, posQuery)}?${params.toString()}`;
}

// Note : les BLOB SQLite reviennent adossés à un ArrayBuffer classique (jamais
// partagé) ; on le type explicitement `Uint8Array<ArrayBuffer>` pour satisfaire
// `BodyInit` (BufferSource exclut SharedArrayBuffer) au moment de bâtir la Response.

/** Entrée de cache renvoyée au routeur. */
export interface EntreeCache {
  corps: Uint8Array<ArrayBuffer>;
  contentType: string;
}

interface LigneCache {
  corps: Uint8Array<ArrayBuffer>;
  contentType: string;
  expireA: number;
}

/**
 * Lit une entrée non expirée. Purge PARESSEUSE : si l'entrée existe mais est
 * expirée, on la supprime et on renvoie `null` (miss).
 */
export function lireCache(cle: string): EntreeCache | null {
  const db = getDb();
  const ligne = db
    .query("SELECT corps, contentType, expireA FROM cache WHERE cle = ?")
    .get(cle) as LigneCache | null;
  if (!ligne) return null;
  if (ligne.expireA <= Date.now()) {
    db.query("DELETE FROM cache WHERE cle = ?").run(cle);
    return null;
  }
  return { corps: ligne.corps, contentType: ligne.contentType };
}

/** Écrit (ou remplace) une entrée de cache avec un TTL en millisecondes. */
export function ecrireCache(
  cle: string,
  corps: Uint8Array,
  contentType: string,
  ttlMs: number,
): void {
  const db = getDb();
  const expireA = Date.now() + ttlMs;
  db.query(
    "INSERT OR REPLACE INTO cache (cle, corps, contentType, expireA) VALUES (?, ?, ?, ?)",
  ).run(cle, corps, contentType, expireA);
}

/** Nombre d'entrées actuellement stockées (utilisé par /health). */
export function compterEntrees(): number {
  const db = getDb();
  const ligne = db.query("SELECT COUNT(*) AS n FROM cache").get() as { n: number };
  return ligne.n;
}

/** Purge de masse des entrées expirées ; renvoie le nombre de lignes supprimées. */
export function purgerExpires(): number {
  const db = getDb();
  return db.query("DELETE FROM cache WHERE expireA <= ?").run(Date.now()).changes;
}
