/**
 * Routes /globe/* — données géopolitiques du globe (fenêtre GLOBE du front).
 *   GET /globe/evenements?fenetreH=24        → cellules GDELT agrégées (grille 0,5°)
 *   GET /globe/evenements/zone?lat=&lon=     → détail d'une cellule (top 20 par mentions)
 *   GET /globe/conflits-ucdp                 → zones UCDP agrégées (Task 5)
 * Stockage : table `globe_evenements` (événements GDELT, rétention 48 h) et
 * `globe_instantanes` (dernier instantané par source — sert le PÉRIMÉ en cas
 * d'échec amont : « jamais d'écran vide », le cache TTL de cache.ts purge
 * l'expiré et ne convient pas). Âge exposé en champ JSON `majA` (epoch ms),
 * convention kv.ts. CREATE TABLE inconditionnel (pas de flag module) : les
 * tests injectent des bases :memory: distinctes via `dInjecte`.
 */
import { Database } from "bun:sqlite";
import { entetesCors } from "./cors";
import { getDb } from "./db";
import { agregerEvenements, cleGrille, type CategorieEvenement, type EvenementGdelt } from "./gdelt";

/** Rétention des événements GDELT (heures). */
export const RETENTION_H = 48;
/** Fenêtre servie par défaut (heures) et bornes du paramètre fenetreH. */
export const FENETRE_DEFAUT_H = 24;

export function assurerTablesGlobe(d: Database): void {
  d.run(`CREATE TABLE IF NOT EXISTS globe_evenements (
    idGdelt TEXT PRIMARY KEY,
    dateMs INTEGER NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    categorie TEXT NOT NULL,
    codeCameo TEXT NOT NULL,
    goldstein REAL NOT NULL,
    mentions INTEGER NOT NULL,
    acteur1 TEXT,
    acteur2 TEXT,
    url TEXT
  )`);
  d.run("CREATE INDEX IF NOT EXISTS idx_globe_evenements_dateMs ON globe_evenements(dateMs)");
  d.run(`CREATE TABLE IF NOT EXISTS globe_instantanes (
    cle TEXT PRIMARY KEY,
    corps TEXT NOT NULL,
    majA INTEGER NOT NULL
  )`);
}

/** Insère en ignorant les doublons (idGdelt). Renvoie le nombre réellement inséré. */
export function ingererEvenements(d: Database, evenements: readonly EvenementGdelt[]): number {
  assurerTablesGlobe(d);
  const stmt = d.query(
    `INSERT OR IGNORE INTO globe_evenements
     (idGdelt, dateMs, lat, lon, categorie, codeCameo, goldstein, mentions, acteur1, acteur2, url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let inseres = 0;
  const tx = d.transaction(() => {
    for (const e of evenements) {
      const info = stmt.run(e.idGdelt, e.dateMs, e.lat, e.lon, e.categorie, e.codeCameo, e.goldstein, e.mentions, e.acteur1, e.acteur2, e.url);
      inseres += Number(info.changes);
    }
  });
  tx();
  return inseres;
}

/** Supprime les événements plus vieux que la rétention. Renvoie le nombre purgé. */
export function purgerEvenements(d: Database, now: number, retentionH: number = RETENTION_H): number {
  assurerTablesGlobe(d);
  const info = d.query("DELETE FROM globe_evenements WHERE dateMs < ?").run(now - retentionH * 3_600_000);
  return Number(info.changes);
}

/** Lit/écrit le dernier instantané d'une source (fallback périmé + méta gdelt). */
export function lireMeta(d: Database, cle: string): { corps: string; majA: number } | null {
  assurerTablesGlobe(d);
  const ligne = d.query("SELECT corps, majA FROM globe_instantanes WHERE cle = ?").get(cle) as { corps: string; majA: number } | null;
  return ligne;
}

export function ecrireMeta(d: Database, cle: string, corps: string, majA: number): void {
  assurerTablesGlobe(d);
  d.query("INSERT OR REPLACE INTO globe_instantanes (cle, corps, majA) VALUES (?, ?, ?)").run(cle, corps, majA);
}

/** Helper JSON + CORS (dupliqué volontairement par module, convention kv/replay). */
function json(corps: unknown, req: Request, status = 200): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...entetesCors(req) },
  });
}

/** Ligne relue de globe_evenements (forme SELECT *). */
interface LigneEvenement {
  idGdelt: string; dateMs: number; lat: number; lon: number; categorie: CategorieEvenement;
  codeCameo: string; goldstein: number; mentions: number;
  acteur1: string | null; acteur2: string | null; url: string | null;
}

function fenetreDepuisQuery(url: URL): number {
  const brut = Number(url.searchParams.get("fenetreH") ?? FENETRE_DEFAUT_H);
  if (!Number.isFinite(brut)) return FENETRE_DEFAUT_H;
  return Math.min(RETENTION_H, Math.max(1, Math.trunc(brut)));
}

function repondreEvenements(req: Request, url: URL, d: Database, now: number): Response {
  const depuisMs = now - fenetreDepuisQuery(url) * 3_600_000;
  const lignes = d.query("SELECT * FROM globe_evenements WHERE dateMs >= ?").all(depuisMs) as LigneEvenement[];
  let deMs = Number.POSITIVE_INFINITY;
  let aMs = Number.NEGATIVE_INFINITY;
  for (const l of lignes) { deMs = Math.min(deMs, l.dateMs); aMs = Math.max(aMs, l.dateMs); }
  // agregerEvenements n'exige que les champs communs — les lignes SQL en ont la forme.
  const cellules = agregerEvenements(lignes.map((l) => ({ ...l, racine: "", quadClass: 0 })));
  const meta = lireMeta(d, "gdelt");
  return json(
    { majA: meta?.majA ?? null, couverture: lignes.length > 0 ? { deMs, aMs } : null, cellules },
    req,
  );
}

function repondreZone(req: Request, url: URL, d: Database, now: number): Response {
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json({ erreur: "lat/lon requis" }, req, 400);
  const depuisMs = now - fenetreDepuisQuery(url) * 3_600_000;
  const lignes = d.query("SELECT * FROM globe_evenements WHERE dateMs >= ?").all(depuisMs) as LigneEvenement[];
  const evenements = lignes
    .filter((l) => cleGrille(l.lat) === lat && cleGrille(l.lon) === lon)
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 20)
    .map((l) => ({
      dateMs: l.dateMs, categorie: l.categorie, codeCameo: l.codeCameo, goldstein: l.goldstein,
      mentions: l.mentions, acteur1: l.acteur1, acteur2: l.acteur2, url: l.url,
    }));
  return json({ evenements }, req);
}

/** Gestionnaire des routes /globe/*. Gardes AVANT tout accès base (testables sans disque). */
export async function traiterGlobe(req: Request, url: URL, dInjecte?: Database, now?: number): Promise<Response> {
  if (req.method !== "GET") return json({ erreur: "méthode non autorisée" }, req, 405);
  const chemin = url.pathname;
  if (chemin !== "/globe/evenements" && chemin !== "/globe/evenements/zone" && chemin !== "/globe/conflits-ucdp") {
    return json({ erreur: "chemin inconnu" }, req, 404);
  }
  const d = dInjecte ?? getDb();
  const maintenant = now ?? Date.now();
  try {
    assurerTablesGlobe(d);
    if (chemin === "/globe/evenements") return repondreEvenements(req, url, d, maintenant);
    if (chemin === "/globe/evenements/zone") return repondreZone(req, url, d, maintenant);
    return await repondreConflitsUcdp(req, d, maintenant); // implémentée en Task 5
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return json({ erreur: "erreur interne globe", detail }, req, 500);
  }
}

/** Placeholder Task 5 — la route UCDP répond 503 tant que le rafraîchissement n'existe pas. */
async function repondreConflitsUcdp(req: Request, _d: Database, _now: number): Promise<Response> {
  return json({ erreur: "non câblé (Task 5)" }, req, 503);
}
