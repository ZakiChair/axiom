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
  _db = db;
  return db;
}
