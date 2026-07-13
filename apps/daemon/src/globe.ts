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
import { agregerEvenements, cleGrille, parseDateGdelt, parseTrancheGdelt, type CategorieEvenement, type EvenementGdelt } from "./gdelt";
import type { Routeur } from "./router";
import { agregerUcdp, choisirFichierCandidat, parseCsv } from "./ucdp";
import { extraireFichierZip } from "./zip";

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
      // Défense en profondeur (cf. XSS NewsWindow, lot E1) : SOURCEURL amont sera
      // rendue en href côté front — seuls les schémas http(s) sont conservés.
      const url = e.url !== null && (e.url.startsWith("http://") || e.url.startsWith("https://")) ? e.url : null;
      const info = stmt.run(e.idGdelt, e.dateMs, e.lat, e.lon, e.categorie, e.codeCameo, e.goldstein, e.mentions, e.acteur1, e.acteur2, url);
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
  const latBrut = url.searchParams.get("lat");
  const lonBrut = url.searchParams.get("lon");
  // Piège Number(null) === 0 : un paramètre ABSENT ne doit pas passer pour 0.
  if (latBrut === null || lonBrut === null) return json({ erreur: "lat/lon requis" }, req, 400);
  const lat = Number(latBrut);
  const lon = Number(lonBrut);
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
export async function traiterGlobe(
  req: Request,
  url: URL,
  dInjecte?: Database,
  now?: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (req.method !== "GET") return json({ erreur: "méthode non autorisée" }, req, 405);
  const chemin = url.pathname;
  if (chemin !== "/globe/evenements" && chemin !== "/globe/evenements/zone" && chemin !== "/globe/conflits-ucdp") {
    return json({ erreur: "chemin inconnu" }, req, 404);
  }
  const maintenant = now ?? Date.now();
  try {
    // getDb() DANS le try : un échec d'ouverture disque doit répondre 500, pas
    // remonter en throw nu vers Bun.serve.
    const d = dInjecte ?? getDb();
    assurerTablesGlobe(d);
    if (chemin === "/globe/evenements") return repondreEvenements(req, url, d, maintenant);
    if (chemin === "/globe/evenements/zone") return repondreZone(req, url, d, maintenant);
    return await repondreConflitsUcdp(req, d, maintenant, fetchImpl);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return json({ erreur: "erreur interne globe", detail }, req, 500);
  }
}

// ————— Rafraîchissement amont (GDELT http-only, UCDP https) —————
// data.gdeltproject.org ne répond QU'EN HTTP (vérifié 2026-07-12) : c'est le
// premier amont http:// clair du daemon — impossible via /extapi (schéma https
// imposé + whitelist). Trafic localhost → amont public, aucun secret transmis.

const URL_LASTUPDATE = "http://data.gdeltproject.org/gdeltv2/lastupdate.txt";
const URL_INDEX_UCDP = "https://ucdp.uu.se/downloads/index.html";
const BASE_UCDP = "https://ucdp.uu.se/downloads/candidateged/";
const TIMEOUT_AMONT_MS = 15_000;
const BACKFILL_TRANCHES = 12; // 3 h d'historique au premier démarrage
const TAILLE_MAX_ZIP = 30 * 1024 * 1024; // bornage des corps amont (zip GDELT, CSV UCDP)
const FRAICHEUR_UCDP_MS = 24 * 3_600_000;
export const INTERVALLE_BOUCLE_GLOBE_MS = 15 * 60_000;

function entetesAmont(): Record<string, string> {
  return { "user-agent": "axiom-daemon/1.0 (terminal perso)", accept: "*/*" };
}

/** URL de la tranche courante + les (n-1) précédentes, par pas de 15 min. Pure. */
export function urlsTranches(urlDerniere: string, n: number): string[] {
  const m = /^(.*\/)(\d{14})(\.export\.CSV\.zip)$/.exec(urlDerniere);
  if (m === null) return [urlDerniere];
  const [, base, horodatage, suffixe] = m;
  const dateMs = parseDateGdelt(horodatage ?? "");
  if (dateMs === null) return [urlDerniere];
  const urls: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(dateMs - i * 15 * 60_000);
    const p = (v: number, l = 2) => String(v).padStart(l, "0");
    urls.push(`${base}${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}${suffixe}`);
  }
  return urls;
}

/**
 * Ingestion GDELT : lit lastupdate.txt ; si la tranche a déjà été vue → no-op.
 * Sinon ingère la tranche courante + backfill (premier démarrage : 12 tranches,
 * ensuite : celles publiées depuis la dernière vue, plafonné à 12). Un 404 sur
 * une tranche individuelle est toléré (tranche sautée). Purge la rétention puis
 * écrit la méta { url } (tranche RÉUSSIE la plus récente) sous la clé "gdelt" avec
 * majA = now — SEULEMENT si au moins une tranche a été ingérée : un échec total ne
 * marque rien « vu », et une courante en échec n'est pas figée « vue » à tort.
 */
export async function rafraichirGdelt(
  d: Database,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<{ tranches: number; inseres: number }> {
  assurerTablesGlobe(d);
  const resIndex = await fetchImpl(URL_LASTUPDATE, { headers: entetesAmont(), signal: AbortSignal.timeout(TIMEOUT_AMONT_MS) });
  if (!resIndex.ok) throw new Error(`lastupdate HTTP ${resIndex.status}`);
  const premiereLigne = (await resIndex.text()).split("\n")[0] ?? "";
  const urlZip = premiereLigne.trim().split(/\s+/)[2] ?? "";
  if (!urlZip.endsWith(".export.CSV.zip")) throw new Error("lastupdate.txt : URL de tranche introuvable");
  // Anti-SSRF : l'URL vient du CONTENU amont — ne fetcher que le motif GDELT exact.
  if (!/^http:\/\/data\.gdeltproject\.org\/gdeltv2\/\d{14}\.export\.CSV\.zip$/.test(urlZip)) {
    throw new Error("lastupdate.txt : URL de tranche inattendue");
  }
  const meta = lireMeta(d, "gdelt");
  const derniereVue = meta === null ? null : (JSON.parse(meta.corps) as { url?: string }).url ?? null;
  if (derniereVue === urlZip) return { tranches: 0, inseres: 0 };
  // Candidates : la courante + backfill ; on s'arrête à la dernière déjà vue.
  const candidates: string[] = [];
  for (const u of urlsTranches(urlZip, BACKFILL_TRANCHES)) {
    if (u === derniereVue) break;
    candidates.push(u);
  }
  let tranches = 0;
  let inseres = 0;
  // URL de la tranche RÉUSSIE la plus récente. Les candidates sont ordonnées de la plus
  // récente à la plus ancienne → la 1re réussie de la liste est la plus récente. C'est ELLE
  // qu'on marque « vue » (pas urlZip) : si la courante a échoué, elle reste réingérable.
  let urlPlusRecenteReussie: string | null = null;
  for (const u of candidates) {
    try {
      const res = await fetchImpl(u, { headers: entetesAmont(), signal: AbortSignal.timeout(TIMEOUT_AMONT_MS) });
      if (!res.ok) continue; // tranche manquante/404 : tolérée
      // Pré-bornage sur l'en-tête (amont http-only, MITM-able) : corps annoncé trop gros → sauté.
      const cl = res.headers.get("content-length");
      if (cl !== null && Number(cl) > TAILLE_MAX_ZIP) continue;
      const zip = new Uint8Array(await res.arrayBuffer());
      if (zip.byteLength > TAILLE_MAX_ZIP) continue; // bornage : tranche anormalement grosse sautée
      inseres += ingererEvenements(d, parseTrancheGdelt(new TextDecoder().decode(extraireFichierZip(zip))));
      tranches += 1;
      if (urlPlusRecenteReussie === null) urlPlusRecenteReussie = u;
    } catch {
      // Tranche individuelle en échec (réseau/zip corrompu) : sautée, les autres continuent.
    }
  }
  purgerEvenements(d, now);
  // Méta = tranche RÉUSSIE la plus récente : sur échec TOTAL rien n'est marqué « vu »
  // (pas de perte silencieuse) ; si urlZip a échoué, elle n'est pas figée « vue » à tort.
  if (urlPlusRecenteReussie !== null) ecrireMeta(d, "gdelt", JSON.stringify({ url: urlPlusRecenteReussie }), now);
  return { tranches, inseres };
}

/**
 * Rafraîchit l'instantané UCDP : découvre le fichier candidat courant sur la
 * page d'index, télécharge/parse/agrège, stocke le JSON sous la clé "ucdp".
 * Renvoie false (sans jeter) si l'amont est injoignable — l'appelant décide
 * de servir le périmé.
 */
export async function rafraichirUcdp(
  d: Database,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<boolean> {
  try {
    const resIndex = await fetchImpl(URL_INDEX_UCDP, { headers: entetesAmont(), signal: AbortSignal.timeout(TIMEOUT_AMONT_MS) });
    if (!resIndex.ok) return false;
    const fichier = choisirFichierCandidat(await resIndex.text());
    if (fichier === null) return false;
    const resCsv = await fetchImpl(`${BASE_UCDP}${fichier}`, { headers: entetesAmont(), signal: AbortSignal.timeout(TIMEOUT_AMONT_MS * 4) });
    if (!resCsv.ok) return false;
    // Pré-bornage sur l'en-tête avant lecture du corps : réponse annoncée trop grosse → abandon.
    const clCsv = resCsv.headers.get("content-length");
    if (clCsv !== null && Number(clCsv) > TAILLE_MAX_ZIP) return false;
    const texte = await resCsv.text();
    if (texte.length > TAILLE_MAX_ZIP) return false; // bornage : réponse anormalement grosse
    const zones = agregerUcdp(parseCsv(texte));
    if (zones.length === 0) return false; // réponse vide/inattendue : ne pas écraser un bon instantané
    ecrireMeta(d, "ucdp", JSON.stringify({ fichier, zones }), now);
    return true;
  } catch {
    return false;
  }
}

/** Sert l'instantané UCDP ; le rafraîchit d'abord s'il est absent ou > 24 h. */
async function repondreConflitsUcdp(req: Request, d: Database, now: number, fetchImpl: typeof fetch): Promise<Response> {
  let meta = lireMeta(d, "ucdp");
  let stale = false;
  if (meta === null || now - meta.majA > FRAICHEUR_UCDP_MS) {
    const ok = await rafraichirUcdp(d, fetchImpl, now);
    if (ok) meta = lireMeta(d, "ucdp");
    else if (meta !== null) stale = true; // périmé servi quand même : jamais d'écran vide
  }
  if (meta === null) {
    return new Response(JSON.stringify({ erreur: "amont injoignable", detail: "UCDP indisponible et aucun instantané" }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8", ...entetesCors(req) },
    });
  }
  const { fichier, zones } = JSON.parse(meta.corps) as { fichier: string; zones: unknown[] };
  return new Response(JSON.stringify({ majA: meta.majA, fichier, zones }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-axiomd-cache": stale ? "stale" : "hit",
      ...entetesCors(req),
    },
  });
}

/**
 * Boucle d'ingestion GDELT (pattern demarrerBoucleSnapshots) : un tick immédiat
 * non bloquant puis toutes les 15 min — UNIQUEMENT du stockage à froid, jamais
 * sur le chemin chaud du renderer (BUILD-CONTRACT).
 */
export function demarrerBoucleGlobe(): () => void {
  const tickGdelt = () => {
    rafraichirGdelt(getDb()).catch((err: unknown) => {
      console.error("[globe] rafraîchissement GDELT en échec :", err instanceof Error ? err.message : err);
    });
  };
  // UCDP : 1er seed au démarrage (sinon 502 tant que personne n'ouvre GLOBE) +
  // re-check périodique (même cadence : rafraichirUcdp no-op si < 24 h).
  const tickUcdp = () => {
    rafraichirUcdp(getDb()).catch((err: unknown) => {
      console.error("[globe] rafraîchissement UCDP en échec :", err instanceof Error ? err.message : err);
    });
  };
  const timerGdelt = setTimeout(tickGdelt, 3_000);
  const timerUcdp = setTimeout(tickUcdp, 5_000); // léger décalage vs GDELT
  const intervalle = setInterval(tickGdelt, INTERVALLE_BOUCLE_GLOBE_MS);
  // UCDP ~1×/jour suffit ; on re-vérifie toutes les 6 h (interne : skip si frais).
  const intervalleUcdp = setInterval(tickUcdp, 6 * 3_600_000);
  return () => {
    clearTimeout(timerGdelt);
    clearTimeout(timerUcdp);
    clearInterval(intervalle);
    clearInterval(intervalleUcdp);
  };
}

/** Enregistre le préfixe /globe (modèle enregistrerReplay). */
export function enregistrerGlobe(routeur: Routeur): void {
  routeur.enregistrerPrefixe("/globe", (req, url) => traiterGlobe(req, url));
}
