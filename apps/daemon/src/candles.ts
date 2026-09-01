/**
 * Cache long terme des bougies OHLCV (SQLite via db.ts).
 *
 * But (roadmap §2.2) : accumuler ENTRE LES SESSIONS l'historique que le front pousse,
 * en particulier les séries à quota / à fenêtre glissante côté fournisseur :
 *   - dérivés Coinalyze (purgés ~quotidiennement chez eux, ~1500-2000 pts) ;
 *   - tradfi Twelve Data (crédits limités) ;
 *   - échantillons macro.
 * Le daemon ne COLLECTE rien de lui-même : il ne stocke QUE ce que le front lui envoie
 * (POST), et le ressert (GET). Aucune boucle autonome, aucun WS — le chemin chaud du
 * renderer reste 100 % direct vers les exchanges (BUILD-CONTRACT).
 *
 * Schéma : candles(source, symbole, tf, t INTEGER, o,h,l,c,v, PK(source,symbole,tf,t)).
 * `t` = open time (ms epoch). Upsert idempotent par clé primaire.
 *
 * Routes :
 *   POST /candles/:source/:symbole/:tf         → lot upsert (corps = JSON [{t,o,h,l,c,v}])
 *   GET  /candles/:source/:symbole/:tf?depuis&jusqua&limite → bougies triées par t croissant
 */
import { entetesCors } from "./cors";
import { getDb } from "./db";
import { avecGardeErreur, type Routeur } from "./router";

/** Limite de lignes par GET (défaut) et plafond dur (garde-fou mémoire). */
export const LIMITE_DEFAUT = 5000;
export const LIMITE_MAX = 50_000;

let tableAssuree = false;

/** Renvoie la base en garantissant (une fois) l'existence de la table `candles`. */
function db() {
  const d = getDb();
  if (!tableAssuree) {
    d.run(`CREATE TABLE IF NOT EXISTS candles (
      source TEXT NOT NULL,
      symbole TEXT NOT NULL,
      tf TEXT NOT NULL,
      t INTEGER NOT NULL,
      o REAL NOT NULL,
      h REAL NOT NULL,
      l REAL NOT NULL,
      c REAL NOT NULL,
      v REAL NOT NULL,
      PRIMARY KEY (source, symbole, tf, t)
    )`);
    tableAssuree = true;
  }
  return d;
}

/** Bougie au format de fil compact (aligné sur le stockage). */
export interface BougieFil {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** Segments décodés d'un chemin `/candles/:source/:symbole/:tf`. */
export interface CheminCandles {
  source: string;
  symbole: string;
  tf: string;
}

/**
 * Découpe un pathname `/candles/:source/:symbole/:tf` (segments URL-décodés).
 * Renvoie `null` si la forme n'est pas reconnue. Fonction PURE.
 */
export function parseCheminCandles(pathname: string): CheminCandles | null {
  const segments = pathname.split("/").filter((s) => s.length > 0);
  // segments[0] === "candles" (garanti par le préfixe de route)
  if (segments.length !== 4) return null;
  return {
    source: decode(segments[1]),
    symbole: decode(segments[2]),
    tf: decode(segments[3]),
  };
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
 * Normalise un corps arbitraire en tableau de bougies valides. Chaque bougie doit
 * porter t,o,h,l,c,v tous nombres finis ; les entrées invalides sont ÉCARTÉES (le lot
 * partiel n'échoue pas). Fonction PURE (testée).
 */
export function normaliserBougies(corps: unknown): BougieFil[] {
  if (!Array.isArray(corps)) return [];
  const out: BougieFil[] = [];
  for (const brut of corps) {
    if (!brut || typeof brut !== "object") continue;
    const o = brut as Record<string, unknown>;
    if (
      estNombreFini(o.t) &&
      estNombreFini(o.o) &&
      estNombreFini(o.h) &&
      estNombreFini(o.l) &&
      estNombreFini(o.c) &&
      estNombreFini(o.v)
    ) {
      out.push({ t: o.t, o: o.o, h: o.h, l: o.l, c: o.c, v: o.v });
    }
  }
  return out;
}

/** Bornes/limite d'une requête GET candles (lues depuis la query). Fonction PURE. */
export interface RequeteCandles {
  depuis: number | null;
  jusqua: number | null;
  limite: number;
}

/** Extrait `depuis`/`jusqua`/`limite` d'une query, avec bornage. Fonction PURE. */
export function parseRequeteCandles(params: URLSearchParams): RequeteCandles {
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

/** Réponse JSON avec en-têtes CORS. */
function json(corps: unknown, req: Request, status = 200): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...entetesCors(req) },
  });
}

/** Traite une requête `/candles/...`. */
export async function traiterCandles(req: Request, url: URL): Promise<Response> {
  const chemin = parseCheminCandles(url.pathname);
  if (!chemin) return json({ erreur: "chemin candles invalide" }, req, 400);
  const { source, symbole, tf } = chemin;

  if (req.method === "POST") {
    let corps: unknown;
    try {
      corps = await req.json();
    } catch {
      return json({ erreur: "corps non-JSON" }, req, 400);
    }
    const bougies = normaliserBougies(corps);
    const inserer = db().query(
      "INSERT OR REPLACE INTO candles (source, symbole, tf, t, o, h, l, c, v) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const tx = db().transaction((lot: BougieFil[]) => {
      for (const b of lot) inserer.run(source, symbole, tf, b.t, b.o, b.h, b.l, b.c, b.v);
    });
    tx(bougies);
    return json(
      { ok: true, source, symbole, tf, recus: Array.isArray(corps) ? corps.length : 0, ecrits: bougies.length },
      req,
    );
  }

  if (req.method === "GET") {
    const { depuis, jusqua, limite } = parseRequeteCandles(url.searchParams);
    let sql = "SELECT t, o, h, l, c, v FROM candles WHERE source = ? AND symbole = ? AND tf = ?";
    const params: Array<string | number> = [source, symbole, tf];
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
    const bougies = db().query(sql).all(...params) as BougieFil[];
    return json({ source, symbole, tf, bougies }, req);
  }

  return json({ erreur: "méthode non permise" }, req, 405);
}

/** Enregistre la route `/candles` dans le routeur. */
export function enregistrerCandles(routeur: Routeur): void {
  routeur.enregistrerPrefixe("/candles", avecGardeErreur("candles", (req, url) => traiterCandles(req, url)));
}
