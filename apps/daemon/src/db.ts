/**
 * Accès SQLite du daemon (bun:sqlite, ZÉRO dépendance externe).
 *
 * Un seul fichier `apps/daemon/axiom.db` (gitignored). Pour l'instant une seule
 * table `cache` (voir cache.ts) ; les agents suivants (kv, candles) ajouteront
 * leurs tables via `getDb()`.
 *
 * Ouverture PARESSEUSE (`getDb`) : importer ce module n'ouvre pas la base — cela
 * garde les tests de logique pure (env, cache, proxy) sans effet de bord disque.
 */
import { Database } from "bun:sqlite";
import { join } from "node:path";

/** Fichier SQLite unique du daemon (module-relatif → indépendant du cwd). */
export const CHEMIN_DB = join(import.meta.dir, "..", "axiom.db");

/**
 * Fraction de pages LIBRES au-delà de laquelle on compacte (cf. `compacterSiNecessaire`).
 * 20 % : assez haut pour ne quasi jamais se déclencher en régime normal, assez bas pour
 * rattraper l'espace laissé par les purges de rétention (snapshots, liquidations, journal).
 */
export const SEUIL_FREELIST = 0.2;

/**
 * Taille de fichier au-delà de laquelle on RENONCE au VACUUM synchrone (256 Mo).
 * bun:sqlite est synchrone : un VACUUM réécrit tout le fichier et bloque l'event loop
 * ENTIER du daemon (plus aucune requête servie, /health compris — le front basculerait
 * en mode dégradé en pleine session). Avec des jours de replay stockés, la base atteint
 * des Go : sous cette borne le VACUUM reste sub-seconde ; au-delà on saute et on log —
 * l'espace libre reste alors simplement dans la freelist (réutilisé par SQLite).
 */
export const TAILLE_MAX_VACUUM_OCTETS = 256 * 1024 * 1024;

let _db: Database | null = null;

/** Renvoie la connexion SQLite (l'ouvre et crée le schéma au premier appel). */
export function getDb(): Database {
  if (_db) return _db;
  const db = new Database(CHEMIN_DB, { create: true });
  // WAL : lectures/écritures concurrentes plus fluides pour un process long.
  db.run("PRAGMA journal_mode = WAL");
  db.run(`CREATE TABLE IF NOT EXISTS cache (
    cle TEXT PRIMARY KEY,
    corps BLOB NOT NULL,
    contentType TEXT NOT NULL,
    expireA INTEGER NOT NULL
  )`);
  // Snapshots versionnés du KV (cf. snapshots.ts) : sauvegarde quotidienne horodatée
  // de toutes les entrées KV, filet contre une mauvaise manip. Migration idempotente.
  db.run(`CREATE TABLE IF NOT EXISTS kv_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    donnees TEXT NOT NULL
  )`);
  _db = db;
  return db;
}

/**
 * Fraction de pages LIBRES (freelist) dans le fichier : `freelist_count / page_count`.
 * Base vide (0 page, ex. `:memory:` fraîche) → 0 (pas de division par zéro).
 */
export function ratioFreelist(d: Database): number {
  const { freelist_count: libres } = d.query("PRAGMA freelist_count").get() as { freelist_count: number };
  const { page_count: total } = d.query("PRAGMA page_count").get() as { page_count: number };
  return total > 0 ? libres / total : 0;
}

/**
 * Récupère l'espace disque laissé par les purges de rétention SI la freelist dépasse
 * `seuil`. Renvoie vrai si un compactage a eu lieu.
 *
 * POURQUOI un VACUUM complet conditionnel plutôt qu'`incremental_vacuum` : la base a
 * été créée avec `auto_vacuum=0` (défaut), et sous ce mode SQLite ne tient AUCUNE carte
 * des pages libres — `PRAGMA incremental_vacuum` y est un no-op silencieux (vérifié :
 * freelist inchangée). Le faire fonctionner exigerait `auto_vacuum=INCREMENTAL` **plus**
 * un VACUUM complet pour matérialiser le changement : autant garder le VACUUM seul, et
 * la garde sur la freelist suffit à le rendre rare (après coup elle retombe à 0).
 *
 * WAL : le VACUUM réécrit la base LOGIQUE mais le fichier n'est tronqué qu'au
 * checkpoint — sans lui la freelist tombe à 0 et les mégaoctets restent sur disque.
 * D'où le `wal_checkpoint(TRUNCATE)` juste après (inoffensif hors WAL).
 *
 * Un VACUUM ne peut PAS tourner dans une transaction : ces `run` sont volontairement
 * hors `d.transaction(...)`.
 *
 * Si le fichier dépasse `tailleMaxOctets` (`TAILLE_MAX_VACUUM_OCTETS`, 256 Mo), on
 * saute le VACUUM : mieux vaut garder la freelist qu'un daemon gelé des minutes.
 */
export function compacterSiNecessaire(
  d: Database,
  seuil = SEUIL_FREELIST,
  tailleMaxOctets = TAILLE_MAX_VACUUM_OCTETS,
): boolean {
  if (ratioFreelist(d) < seuil) return false;
  const { page_count: pages } = d.query("PRAGMA page_count").get() as { page_count: number };
  const { page_size: taillePage } = d.query("PRAGMA page_size").get() as { page_size: number };
  if (pages * taillePage > tailleMaxOctets) {
    console.warn(
      `[axiomd] compactage sauté : base de ${((pages * taillePage) / 1_048_576).toFixed(0)} Mo ` +
        "au-delà de la borne du VACUUM synchrone (event loop bloquante)",
    );
    return false;
  }
  d.run("VACUUM");
  d.run("PRAGMA wal_checkpoint(TRUNCATE)");
  return true;
}
