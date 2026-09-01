/**
 * Replay de marché (roadmap §4.4) — téléchargement À LA DEMANDE des dumps publics
 * d'aggTrades quotidiens de `data.binance.vision`, stockés en SQLite pour être
 * rejoués par le front.
 *
 * INVARIANT (BUILD-CONTRACT / anti-recommandation #5) : AUCUN recorder tick 24/7.
 * Le daemon ne télécharge un jour QUE sur demande explicite du front (POST) — ce
 * n'est pas un « AggregationEngine » déguisé. Un jour = un fichier zip officiel,
 * décompressé via `unzip -p` (présent sur macOS), parsé en flux, inséré par lots.
 *
 * URL amont :
 *   https://data.binance.vision/data/spot/daily/aggTrades/<SYMBOLE>/<SYMBOLE>-aggTrades-<YYYY-MM-DD>.zip
 *
 * Schéma SQLite :
 *   replay_trades(symbole, jour, t INTEGER, prix REAL, qty REAL, isBuyerMaker INTEGER)
 *     + index (symbole, jour, t)   [t = ms epoch]
 *   replay_jobs(symbole, jour, etat, recus, octets, erreur, majA, PK(symbole,jour))
 *
 * Routes :
 *   POST   /replay/download            {symbole, jour}   → lance/retrouve un job (idempotent)
 *   GET    /replay/status/:symbole/:jour                 → état du job
 *   GET    /replay/trades/:symbole/:jour?depuis&limite   → page de trades (t croissant)
 *   GET    /replay/jours                                 → jours téléchargés (panneau stockage)
 *   DELETE /replay/trades/:symbole/:jour                 → purge d'un jour
 */
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { entetesCors } from "./cors";
import { getDb } from "./db";
import type { Routeur } from "./router";

/** Base des dumps publics Binance (spot, aggTrades quotidiens). */
const BASE_VISION = "https://data.binance.vision/data/spot/daily/aggTrades";
/** Lignes insérées par transaction SQLite (compromis débit/mémoire). */
const TAILLE_LOT = 50_000;
/** Garde-fou : nombre max de trades acceptés pour un jour (évite un run fou). */
const MAX_LIGNES = 20_000_000;
/** Garde-fou concurrence : nombre max de téléchargements simultanés. */
const MAX_TELECHARGEMENTS = 3;
/** Limite de lignes par page GET (défaut) et plafond dur (garde-fou mémoire). */
export const LIMITE_DEFAUT = 50_000;
export const LIMITE_MAX = 100_000;

/** Jobs en cours (clé `symbole|jour`) — garde-fou concurrence en mémoire. */
const enCours = new Set<string>();

let tablesAssurees = false;

/** Renvoie la base en garantissant (une fois) l'existence des tables replay_*. */
function db() {
  const d = getDb();
  if (!tablesAssurees) {
    d.run(`CREATE TABLE IF NOT EXISTS replay_trades (
      symbole TEXT NOT NULL,
      jour TEXT NOT NULL,
      t INTEGER NOT NULL,
      prix REAL NOT NULL,
      qty REAL NOT NULL,
      isBuyerMaker INTEGER NOT NULL
    )`);
    d.run(`CREATE INDEX IF NOT EXISTS idx_replay_trades ON replay_trades (symbole, jour, t)`);
    d.run(`CREATE TABLE IF NOT EXISTS replay_jobs (
      symbole TEXT NOT NULL,
      jour TEXT NOT NULL,
      etat TEXT NOT NULL,
      recus INTEGER NOT NULL DEFAULT 0,
      octets INTEGER NOT NULL DEFAULT 0,
      erreur TEXT,
      majA INTEGER NOT NULL,
      PRIMARY KEY (symbole, jour)
    )`);
    tablesAssurees = true;
  }
  return d;
}

// ─────────────────────────── Parsing CSV (fonctions PURES, testées) ───────────────────────────

/** Une ligne de trade normalisée (format de stockage / de fil). */
export interface LigneTrade {
  t: number; // ms epoch
  prix: number;
  qty: number;
  isBuyerMaker: 0 | 1;
}

/**
 * Normalise un horodatage Binance en MILLISECONDES. Depuis 2025, certains dumps
 * publient en MICROSECONDES ; un timestamp ms de 2026 vaut ~1.8e12, un µs ~1.8e15.
 * Seuil 1e14 : au-delà, on considère des µs et on divise par 1000. Fonction PURE.
 */
export function normaliserHorodatage(brut: number): number {
  if (!Number.isFinite(brut)) return NaN;
  return brut > 1e14 ? Math.floor(brut / 1000) : Math.floor(brut);
}

/** Interprète un booléen CSV Binance (`true`/`false`/`1`/`0`, insensible à la casse). */
function parseBooleen(v: string): 0 | 1 {
  const s = v.trim().toLowerCase();
  return s === "true" || s === "1" ? 1 : 0;
}

/**
 * Parse UNE ligne CSV d'aggTrades spot :
 *   aggId, prix, qty, firstId, lastId, timestamp, isBuyerMaker, isBestMatch
 * Renvoie `null` si la ligne est un en-tête ou malformée (champs non numériques).
 * Fonction PURE (testée).
 */
export function parseLigneTrade(ligne: string): LigneTrade | null {
  const l = ligne.trim();
  if (l.length === 0) return null;
  const champs = l.split(",");
  if (champs.length < 7) return null;
  const prix = Number(champs[1]);
  const qty = Number(champs[2]);
  const t = normaliserHorodatage(Number(champs[5]));
  // En-tête (« agg_trade_id,price,… ») → champs[1] = "price" → NaN → écartée.
  if (!Number.isFinite(prix) || !Number.isFinite(qty) || !Number.isFinite(t)) return null;
  return { t, prix, qty, isBuyerMaker: parseBooleen(champs[6] ?? "") };
}

/**
 * Parse un CSV complet d'aggTrades en trades valides (en-tête et lignes invalides
 * écartés sans faire échouer le lot). Fonction PURE (testée). Le job de
 * téléchargement, lui, parse EN FLUX ligne par ligne (mémoire bornée) via
 * `parseLigneTrade`.
 */
export function parseAggTradesCsv(texte: string): LigneTrade[] {
  const out: LigneTrade[] = [];
  for (const ligne of texte.split("\n")) {
    const trade = parseLigneTrade(ligne);
    if (trade !== null) out.push(trade);
  }
  return out;
}

/** Sous-ensemble de Bun.Subprocess consommé par la lecture (testable avec un process factice). */
export interface ProcessusUnzip {
  stdout: ReadableStream<Uint8Array>;
  kill: () => void;
  exited: Promise<number>;
}

/**
 * Consomme le stdout CSV d'un process `unzip -p` : parsing ligne à ligne, lots de
 * `tailleLot` remis à `onLot`, borne dure `maxLignes`. BORNE MÉMOIRE EFFECTIVE : au
 * dépassement, le process est TUÉ et le flux ANNULÉ AVANT `await exited` — sinon Bun
 * draine tout le stdout restant du child en RSS (~1-2 Go de CSV décompressé pour un
 * dump juste au-dessus du seuil ; vérifié empiriquement avec releaseLock+exited).
 */
export async function lireTradesDepuisProcessus(
  proc: ProcessusUnzip,
  onLot: (lot: LigneTrade[]) => void,
  maxLignes: number = MAX_LIGNES,
  tailleLot: number = TAILLE_LOT,
): Promise<{ recus: number; deborde: boolean }> {
  const decodeur = new TextDecoder();
  let reste = "";
  let lot: LigneTrade[] = [];
  let recus = 0;
  let deborde = false;

  const viderLot = (): void => {
    if (lot.length === 0) return;
    onLot(lot);
    recus += lot.length;
    lot = [];
  };

  const lecteur = proc.stdout.getReader();
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    if (value) reste += decodeur.decode(value, { stream: true });
    let nl = reste.indexOf("\n");
    while (nl !== -1) {
      const ligne = reste.slice(0, nl);
      reste = reste.slice(nl + 1);
      const tr = parseLigneTrade(ligne);
      if (tr !== null) {
        lot.push(tr);
        if (lot.length >= tailleLot) viderLot();
        if (recus + lot.length > maxLignes) {
          deborde = true;
          break;
        }
      }
      nl = reste.indexOf("\n");
    }
    if (deborde) break;
  }
  if (deborde) {
    proc.kill();
    await lecteur.cancel().catch(() => {});
  } else {
    lecteur.releaseLock();
    // Dernière ligne éventuelle (sans \n final).
    const tr = parseLigneTrade(reste);
    if (tr !== null) lot.push(tr);
  }
  viderLot();
  await proc.exited;
  return { recus, deborde };
}

// ─────────────────────────── Validation & parsing de chemin (PURES) ───────────────────────────

/** Valide un jour au format `YYYY-MM-DD`. Fonction PURE. */
export function estJourValide(jour: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(jour);
}

/** Valide un symbole spot (lettres/chiffres, 2-30 car.). Fonction PURE. */
export function estSymboleValide(symbole: string): boolean {
  return /^[A-Z0-9]{2,30}$/.test(symbole);
}

/** Segments décodés d'un chemin `/replay/<verbe>/:symbole/:jour`. */
export interface CheminReplay {
  symbole: string;
  jour: string;
}

/**
 * Découpe `/replay/<verbe>/:symbole/:jour` (segments URL-décodés, symbole en MAJ).
 * Renvoie `null` si la forme n'est pas reconnue. Fonction PURE (testée).
 */
export function parseCheminReplay(pathname: string): CheminReplay | null {
  const segments = pathname.split("/").filter((s) => s.length > 0);
  // segments[0] === "replay" (garanti par le préfixe de route) ; [1] = verbe.
  if (segments.length !== 4) return null;
  const symbole = decode(segments[2]).toUpperCase();
  const jour = decode(segments[3]);
  if (!estSymboleValide(symbole) || !estJourValide(jour)) return null;
  return { symbole, jour };
}

/** Décodage URL tolérant. */
function decode(s: string | undefined): string {
  if (s === undefined) return "";
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Bornes/limite d'une requête GET de trades (lues depuis la query). Fonction PURE. */
export interface RequeteTrades {
  depuis: number | null;
  limite: number;
}

/** Extrait `depuis`/`limite` d'une query, avec bornage. Fonction PURE (testée). */
export function parseRequeteTrades(params: URLSearchParams): RequeteTrades {
  const nombre = (v: string | null): number | null => {
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const limiteBrute = nombre(params.get("limite"));
  const limite =
    limiteBrute === null ? LIMITE_DEFAUT : Math.max(1, Math.min(LIMITE_MAX, Math.floor(limiteBrute)));
  return { depuis: nombre(params.get("depuis")), limite };
}

// ─────────────────────────── Job de téléchargement (asynchrone) ───────────────────────────

/** Met à jour (upsert) l'état d'un job. */
function majJob(
  symbole: string,
  jour: string,
  etat: string,
  recus: number,
  octets: number,
  erreur: string | null,
): void {
  db()
    .query(
      `INSERT OR REPLACE INTO replay_jobs (symbole, jour, etat, recus, octets, erreur, majA)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(symbole, jour, etat, recus, octets, erreur, Date.now());
}

/** Lit l'état d'un job, ou `null` si aucun. */
function lireJob(symbole: string, jour: string): Record<string, unknown> | null {
  const row = db()
    .query("SELECT symbole, jour, etat, recus, octets, erreur, majA FROM replay_jobs WHERE symbole = ? AND jour = ?")
    .get(symbole, jour);
  return (row as Record<string, unknown> | null) ?? null;
}

/**
 * Télécharge + décompresse + insère un jour d'aggTrades. Décompression EN FLUX
 * (`unzip -p`), parsing ligne par ligne, insertion par lots de TAILLE_LOT.
 * Best-effort : toute erreur bascule le job en `erreur`. Le fichier zip temporaire
 * est supprimé en fin (finally).
 */
async function executerTelechargement(symbole: string, jour: string): Promise<void> {
  const cheminTmp = join(tmpdir(), `axiom-replay-${symbole}-${jour}-${Date.now()}.zip`);
  let proc: ReturnType<typeof Bun.spawn> | null = null;
  try {
    majJob(symbole, jour, "en_cours", 0, 0, null);
    // Repart propre : purge un éventuel jour partiel d'un run précédent.
    db().query("DELETE FROM replay_trades WHERE symbole = ? AND jour = ?").run(symbole, jour);

    const url = `${BASE_VISION}/${symbole}/${symbole}-aggTrades-${jour}.zip`;
    const rep = await fetch(url);
    if (!rep.ok) {
      const msg =
        rep.status === 404
          ? "dump introuvable (jour trop récent ou symbole inexistant)"
          : `amont ${rep.status}`;
      majJob(symbole, jour, "erreur", 0, 0, msg);
      return;
    }
    const octetsZip = (await rep.arrayBuffer());
    await Bun.write(cheminTmp, octetsZip);

    proc = Bun.spawn(["unzip", "-p", cheminTmp], { stdout: "pipe", stderr: "pipe" });

    const inserer = db().query(
      "INSERT INTO replay_trades (symbole, jour, t, prix, qty, isBuyerMaker) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const insererLot = db().transaction((lot: LigneTrade[]) => {
      for (const tr of lot) inserer.run(symbole, jour, tr.t, tr.prix, tr.qty, tr.isBuyerMaker);
    });

    let inseres = 0;
    const { recus, deborde } = await lireTradesDepuisProcessus(
      {
        stdout: proc.stdout as ReadableStream<Uint8Array>,
        kill: () => proc?.kill(),
        exited: proc.exited,
      },
      (lot) => {
        insererLot(lot);
        inseres += lot.length;
        majJob(symbole, jour, "en_cours", inseres, octetsZip.byteLength, null);
      },
    );

    if (deborde) {
      majJob(symbole, jour, "erreur", recus, octetsZip.byteLength, `jour trop volumineux (> ${MAX_LIGNES} trades)`);
      return;
    }
    if (recus === 0) {
      majJob(symbole, jour, "erreur", 0, octetsZip.byteLength, "archive vide ou illisible");
      return;
    }
    majJob(symbole, jour, "pret", recus, octetsZip.byteLength, null);
    console.log(
      `[axiomd:replay] ${symbole} ${jour} : ${recus} trades insérés ` +
        `(${(octetsZip.byteLength / 1_048_576).toFixed(1)} Mo zip).`,
    );
  } catch (err) {
    // Même défaut sur le chemin d'erreur : sans kill, Bun drainerait le stdout restant.
    try {
      proc?.kill();
    } catch {
      /* best-effort */
    }
    majJob(symbole, jour, "erreur", 0, 0, err instanceof Error ? err.message : String(err));
  } finally {
    void unlink(cheminTmp).catch(() => {
      /* nettoyage best-effort */
    });
  }
}

// ─────────────────────────── Handlers de routes ───────────────────────────

/** Réponse JSON avec en-têtes CORS. */
function json(corps: unknown, req: Request, status = 200): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...entetesCors(req) },
  });
}

/** POST /replay/download {symbole, jour} — lance ou retrouve un job (idempotent). */
async function traiterDownload(req: Request): Promise<Response> {
  let corps: unknown;
  try {
    corps = await req.json();
  } catch {
    return json({ erreur: "corps non-JSON" }, req, 400);
  }
  const o = (corps ?? {}) as Record<string, unknown>;
  const symbole = String(o.symbole ?? "").toUpperCase();
  const jour = String(o.jour ?? "");
  if (!estSymboleValide(symbole) || !estJourValide(jour)) {
    return json({ erreur: "symbole ou jour invalide" }, req, 400);
  }

  const cle = `${symbole}|${jour}`;
  const job = lireJob(symbole, jour);
  // Idempotent : déjà prêt, ou déjà en cours → on renvoie l'état courant.
  if (job && (job.etat === "pret" || (job.etat === "en_cours" && enCours.has(cle)))) {
    return json({ ...job }, req);
  }
  if (enCours.size >= MAX_TELECHARGEMENTS) {
    return json(
      { etat: "erreur", symbole, jour, erreur: `file pleine (max ${MAX_TELECHARGEMENTS} téléchargements simultanés)` },
      req,
      429,
    );
  }

  enCours.add(cle);
  majJob(symbole, jour, "en_cours", 0, 0, null);
  void executerTelechargement(symbole, jour).finally(() => enCours.delete(cle));
  return json({ etat: "en_cours", symbole, jour, recus: 0 }, req);
}

/** GET /replay/status/:symbole/:jour — état du job. */
function traiterStatus(url: URL, req: Request): Response {
  const chemin = parseCheminReplay(url.pathname);
  if (!chemin) return json({ erreur: "chemin invalide" }, req, 400);
  const job = lireJob(chemin.symbole, chemin.jour);
  if (!job) return json({ etat: "absent", symbole: chemin.symbole, jour: chemin.jour }, req);
  return json({ ...job }, req);
}

/** GET /replay/trades/:symbole/:jour?depuis&limite — page de trades (t croissant). */
function traiterTrades(url: URL, req: Request): Response {
  const chemin = parseCheminReplay(url.pathname);
  if (!chemin) return json({ erreur: "chemin invalide" }, req, 400);
  const { depuis, limite } = parseRequeteTrades(url.searchParams);
  let sql = "SELECT t, prix, qty, isBuyerMaker FROM replay_trades WHERE symbole = ? AND jour = ?";
  const params: Array<string | number> = [chemin.symbole, chemin.jour];
  if (depuis !== null) {
    sql += " AND t >= ?";
    params.push(depuis);
  }
  sql += " ORDER BY t ASC LIMIT ?";
  params.push(limite);
  const trades = db().query(sql).all(...params) as LigneTrade[];
  return json({ symbole: chemin.symbole, jour: chemin.jour, trades }, req);
}

/** GET /replay/jours — jours téléchargés (panneau stockage). */
function traiterJours(req: Request): Response {
  const jours = db()
    .query("SELECT symbole, jour, etat, recus, octets, majA FROM replay_jobs ORDER BY majA DESC")
    .all();
  return json({ jours }, req);
}

/** DELETE /replay/trades/:symbole/:jour — purge d'un jour. */
function traiterPurge(url: URL, req: Request): Response {
  const chemin = parseCheminReplay(url.pathname);
  if (!chemin) return json({ erreur: "chemin invalide" }, req, 400);
  db().query("DELETE FROM replay_trades WHERE symbole = ? AND jour = ?").run(chemin.symbole, chemin.jour);
  db().query("DELETE FROM replay_jobs WHERE symbole = ? AND jour = ?").run(chemin.symbole, chemin.jour);
  return json({ ok: true, symbole: chemin.symbole, jour: chemin.jour }, req);
}

/** Aiguille une requête `/replay/...` vers le bon handler. */
export async function traiterReplay(req: Request, url: URL): Promise<Response> {
  const p = url.pathname;
  if (req.method === "POST" && p === "/replay/download") return traiterDownload(req);
  if (req.method === "GET" && p === "/replay/jours") return traiterJours(req);
  if (req.method === "GET" && p.startsWith("/replay/status/")) return traiterStatus(url, req);
  if (req.method === "GET" && p.startsWith("/replay/trades/")) return traiterTrades(url, req);
  if (req.method === "DELETE" && p.startsWith("/replay/trades/")) return traiterPurge(url, req);
  return json({ erreur: "route replay inconnue" }, req, 404);
}

/** Enregistre le préfixe `/replay` dans le routeur. */
export function enregistrerReplay(routeur: Routeur): void {
  routeur.enregistrerPrefixe("/replay", (req, url) => traiterReplay(req, url));
}
