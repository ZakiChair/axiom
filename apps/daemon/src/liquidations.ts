/**
 * Historique persistant des liquidations (SQLite via db.ts).
 *
 * But (heatmap de liquidations v2) : accumuler ENTRE LES SESSIONS le fil des
 * liquidations que le front pousse, afin de reconstruire la heatmap sur une fenêtre
 * plus longue que ce que les flux temps réel des exchanges exposent. Le daemon ne
 * COLLECTE rien de lui-même dans ce module : il stocke ce qu'on lui envoie (POST /
 * boucle d'ingestion Task 2) et le ressert (GET). Le chemin chaud du renderer reste
 * 100 % direct vers les exchanges (BUILD-CONTRACT).
 *
 * Schéma : liquidations(symbole, venue, t INTEGER, side, price, qty, usd).
 * `t` = timestamp de la liquidation (ms epoch). `side` = côté de la POSITION liquidée
 * ('long' | 'short'). Idempotence par index unique (symbole,venue,t,side,price,qty) —
 * deux liquidations peuvent partager le même ms, d'où une clé large plutôt qu'un PK
 * sur le seul `t`.
 *
 * Routes :
 *   POST /liquidations/:symbole                         → lot insert idempotent (corps = JSON [{t,venue,side,price,qty,usd}])
 *   GET  /liquidations/:symbole?depuis&jusqua&limite     → liquidations triées par t croissant
 */
import { entetesCors } from "./cors";
import { getDb } from "./db";
import type { Routeur } from "./router";

/** Limite de lignes par GET (défaut) et plafond dur (garde-fou mémoire). */
export const LIMITE_DEFAUT = 20_000;
export const LIMITE_MAX = 100_000;

let tableAssuree = false;

/** Renvoie la base en garantissant (une fois) l'existence de la table `liquidations`. */
function db() {
  const d = getDb();
  if (!tableAssuree) {
    d.run(`CREATE TABLE IF NOT EXISTS liquidations (
      symbole TEXT NOT NULL,
      venue   TEXT NOT NULL,
      t       INTEGER NOT NULL,
      side    TEXT NOT NULL,
      price   REAL NOT NULL,
      qty     REAL NOT NULL,
      usd     REAL NOT NULL
    )`);
    d.run(`CREATE UNIQUE INDEX IF NOT EXISTS liq_unique
      ON liquidations (symbole, venue, t, side, price, qty)`);
    d.run("CREATE INDEX IF NOT EXISTS liq_lookup ON liquidations (symbole, t)");
    tableAssuree = true;
  }
  return d;
}

/** Une liquidation au format de fil compact (aligné sur le stockage). */
export interface LiqFil {
  t: number;
  venue: string;
  side: "long" | "short";
  price: number;
  qty: number;
  usd: number;
}

/** Décode le segment `:symbole` d'un chemin `/liquidations/:symbole`, ou `null`. Fonction PURE. */
export function parseCheminLiqs(pathname: string): string | null {
  const segments = pathname.split("/").filter((s) => s.length > 0);
  // segments[0] === "liquidations" (garanti par le préfixe de route)
  if (segments.length !== 2) return null;
  return decode(segments[1]);
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

/** Nombre fini (rejette NaN/±Infinity). */
function estNombreFini(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Normalise un corps arbitraire en tableau de liquidations valides. Chaque entrée doit
 * porter t,price,qty,usd nombres finis, price>0, usd>0, side ∈ {long,short} et venue
 * chaîne non vide ; les entrées invalides sont ÉCARTÉES (le lot partiel n'échoue pas).
 * Fonction PURE (testée).
 */
export function normaliserLiqs(corps: unknown): LiqFil[] {
  if (!Array.isArray(corps)) return [];
  const out: LiqFil[] = [];
  for (const brut of corps) {
    if (!brut || typeof brut !== "object") continue;
    const o = brut as Record<string, unknown>;
    if (
      estNombreFini(o.t) &&
      estNombreFini(o.price) &&
      estNombreFini(o.qty) &&
      estNombreFini(o.usd) &&
      o.price > 0 &&
      o.usd > 0 &&
      (o.side === "long" || o.side === "short") &&
      typeof o.venue === "string" &&
      o.venue.length > 0
    ) {
      out.push({ t: o.t, venue: o.venue, side: o.side, price: o.price, qty: o.qty, usd: o.usd });
    }
  }
  return out;
}

/** Bornes/limite d'une requête GET liquidations (lues depuis la query). Fonction PURE. */
export interface RequeteLiqs {
  depuis: number | null;
  jusqua: number | null;
  limite: number;
}

/** Extrait `depuis`/`jusqua`/`limite` d'une query, avec bornage. Fonction PURE. */
export function parseRequeteLiqs(params: URLSearchParams): RequeteLiqs {
  const nombre = (v: string | null): number | null => {
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const limiteBrute = nombre(params.get("limite"));
  const limite =
    limiteBrute === null ? LIMITE_DEFAUT : Math.max(1, Math.min(LIMITE_MAX, Math.floor(limiteBrute)));
  return { depuis: nombre(params.get("depuis")), jusqua: nombre(params.get("jusqua")), limite };
}

/**
 * Insère un lot de liquidations pour `symbole` (INSERT OR IGNORE, transaction).
 * Renvoie le nombre d'entrées VALIDES du lot (après normalisation). Réutilisée par la
 * boucle d'ingestion (Task 2). Le lot est supposé déjà normalisé par l'appelant.
 */
export function insererLiquidations(symbole: string, lot: LiqFil[]): number {
  const inserer = db().query(
    "INSERT OR IGNORE INTO liquidations (symbole, venue, t, side, price, qty, usd) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const tx = db().transaction((liqs: LiqFil[]) => {
    for (const l of liqs) inserer.run(symbole, l.venue, l.t, l.side, l.price, l.qty, l.usd);
  });
  tx(lot);
  return lot.length;
}

/** Purge les liquidations antérieures à `avantMs` (rétention à froid). */
export function purgerLiquidations(avantMs: number): void {
  db().query("DELETE FROM liquidations WHERE t < ?").run(avantMs);
}

/** Réponse JSON avec en-têtes CORS. */
function json(corps: unknown, req: Request, status = 200): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...entetesCors(req) },
  });
}

/** Traite une requête `/liquidations/...`. */
export async function traiterLiquidations(req: Request, url: URL): Promise<Response> {
  const symbole = parseCheminLiqs(url.pathname);
  if (symbole === null) return json({ erreur: "chemin liquidations invalide" }, req, 400);

  if (req.method === "POST") {
    let corps: unknown;
    try {
      corps = await req.json();
    } catch {
      return json({ erreur: "corps non-JSON" }, req, 400);
    }
    const liqs = normaliserLiqs(corps);
    insererLiquidations(symbole, liqs);
    return json(
      { ok: true, symbole, recus: Array.isArray(corps) ? corps.length : 0, ecrits: liqs.length },
      req,
    );
  }

  if (req.method === "GET") {
    const { depuis, jusqua, limite } = parseRequeteLiqs(url.searchParams);
    let sql = "SELECT t, venue, side, price, qty, usd FROM liquidations WHERE symbole = ?";
    const params: Array<string | number> = [symbole];
    if (depuis !== null) {
      sql += " AND t >= ?";
      params.push(depuis);
    }
    if (jusqua !== null) {
      sql += " AND t <= ?";
      params.push(jusqua);
    }
    sql += " ORDER BY t ASC LIMIT ?";
    params.push(limite);
    const liquidations = db().query(sql).all(...params) as LiqFil[];
    return json({ symbole, liquidations }, req);
  }

  return json({ erreur: "méthode non permise" }, req, 405);
}

/** Enregistre la route `/liquidations` dans le routeur. */
export function enregistrerLiquidations(routeur: Routeur): void {
  routeur.enregistrerPrefixe("/liquidations", (req, url) => traiterLiquidations(req, url));
}
