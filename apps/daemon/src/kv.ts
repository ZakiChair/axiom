/**
 * Store clé/valeur durable du daemon (SQLite via db.ts).
 *
 * But (roadmap §2.2 — persistance durable) : donner au front un stockage qui
 * SURVIT au vidage du cache navigateur. Le front y DOUBLE ses écritures
 * localStorage (namespace « persist », `cle` = clé localStorage) ; au boot il lit
 * le snapshot et réapplique ce que le daemon a de plus récent. SQLite = source de
 * vérité quand le daemon est là ; localStorage = repli quand il est absent.
 *
 * INVARIANT (BUILD-CONTRACT) : purement du stockage à froid — JAMAIS sur le chemin
 * chaud du renderer (les WS de marché du front restent directs).
 *
 * Schéma : kv(namespace, cle, valeur TEXT/JSON, majA INTEGER, PK(namespace, cle)).
 * `valeur` est le CORPS JSON reçu tel quel (opaque pour le daemon) ; `majA` est
 * l'horodatage ms de la dernière écriture EFFECTIVE (cf. idempotence ci-dessous).
 *
 * Routes :
 *   GET    /kv/:ns          → snapshot complet du namespace { entrees: { cle: { valeur, majA } } }
 *   GET    /kv/:ns/:cle      → { namespace, cle, valeur, majA } | 404
 *   PUT    /kv/:ns/:cle      → upsert idempotent (corps = JSON) ; renvoie { majA }
 *   DELETE /kv/:ns/:cle      → suppression ; renvoie { supprime }
 */
import { entetesCors } from "./cors";
import { getDb } from "./db";
import type { Routeur } from "./router";

/** Taille max d'une valeur (1 Mio) — garde-fou contre un corps aberrant. */
export const TAILLE_MAX_VALEUR = 1_048_576;

let tableAssuree = false;

/** Renvoie la base en garantissant (une fois) l'existence de la table `kv`. */
function db() {
  const d = getDb();
  if (!tableAssuree) {
    d.run(`CREATE TABLE IF NOT EXISTS kv (
      namespace TEXT NOT NULL,
      cle TEXT NOT NULL,
      valeur TEXT NOT NULL,
      majA INTEGER NOT NULL,
      PRIMARY KEY (namespace, cle)
    )`);
    tableAssuree = true;
  }
  return d;
}

/** Segments décodés d'un chemin `/kv/...`. Fonction PURE (testée). */
export type CheminKv =
  | { kind: "ns"; ns: string }
  | { kind: "cle"; ns: string; cle: string }
  | null;

/**
 * Découpe un pathname `/kv/:ns` ou `/kv/:ns/:cle` (segments URL-décodés).
 * Renvoie `null` si la forme n'est pas reconnue. Fonction PURE.
 */
export function parseCheminKv(pathname: string): CheminKv {
  const segments = pathname.split("/").filter((s) => s.length > 0);
  // segments[0] === "kv" (garanti par le préfixe de route)
  if (segments.length === 2) return { kind: "ns", ns: decode(segments[1]) };
  if (segments.length === 3) {
    return { kind: "cle", ns: decode(segments[1]), cle: decode(segments[2]) };
  }
  return null;
}

/** Décodage URL tolérant (une clé mal encodée retombe sur sa valeur brute). */
function decode(s: string | undefined): string {
  if (s === undefined) return "";
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Réponse JSON avec en-têtes CORS (repris du pattern proxy.ts). */
function json(corps: unknown, req: Request, status = 200): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...entetesCors(req) },
  });
}

interface LigneKv {
  valeur: string;
  majA: number;
}

/** Traite une requête `/kv/...`. */
export async function traiterKv(req: Request, url: URL): Promise<Response> {
  const chemin = parseCheminKv(url.pathname);
  if (!chemin) return json({ erreur: "chemin kv invalide" }, req, 400);

  // GET /kv/:ns → snapshot complet du namespace.
  if (chemin.kind === "ns") {
    if (req.method !== "GET") return json({ erreur: "méthode non permise" }, req, 405);
    const lignes = db()
      .query("SELECT cle, valeur, majA FROM kv WHERE namespace = ? ORDER BY cle")
      .all(chemin.ns) as Array<{ cle: string; valeur: string; majA: number }>;
    const entrees: Record<string, { valeur: unknown; majA: number }> = {};
    for (const l of lignes) {
      try {
        // `valeur` est du JSON valide (validé à l'écriture) → on l'incorpore parsé.
        entrees[l.cle] = { valeur: JSON.parse(l.valeur), majA: l.majA };
      } catch {
        /* ligne corrompue (ne devrait pas arriver) : ignorée */
      }
    }
    return json({ namespace: chemin.ns, entrees }, req);
  }

  const { ns, cle } = chemin;

  if (req.method === "GET") {
    const ligne = db()
      .query("SELECT valeur, majA FROM kv WHERE namespace = ? AND cle = ?")
      .get(ns, cle) as LigneKv | null;
    if (!ligne) return json({ erreur: "absent" }, req, 404);
    let valeur: unknown;
    try {
      valeur = JSON.parse(ligne.valeur);
    } catch {
      return json({ erreur: "valeur corrompue" }, req, 500);
    }
    return json({ namespace: ns, cle, valeur, majA: ligne.majA }, req);
  }

  if (req.method === "PUT") {
    const corps = await req.text();
    if (corps.length > TAILLE_MAX_VALEUR) {
      return json({ erreur: "valeur trop volumineuse", max: TAILLE_MAX_VALEUR }, req, 413);
    }
    // La valeur DOIT être du JSON (contrat GET /kv : on renvoie du JSON parsé).
    try {
      JSON.parse(corps);
    } catch {
      return json({ erreur: "corps non-JSON" }, req, 400);
    }
    const existant = db()
      .query("SELECT valeur, majA FROM kv WHERE namespace = ? AND cle = ?")
      .get(ns, cle) as LigneKv | null;
    // Écriture IDEMPOTENTE : contenu identique → on préserve `majA` (aucune écriture),
    // ce qui stabilise la comparaison d'horodatage côté front (pas de faux « plus récent »).
    if (existant && existant.valeur === corps) {
      return json({ ok: true, namespace: ns, cle, majA: existant.majA }, req);
    }
    const majA = Date.now();
    db()
      .query("INSERT OR REPLACE INTO kv (namespace, cle, valeur, majA) VALUES (?, ?, ?, ?)")
      .run(ns, cle, corps, majA);
    return json({ ok: true, namespace: ns, cle, majA }, req);
  }

  if (req.method === "DELETE") {
    const info = db().query("DELETE FROM kv WHERE namespace = ? AND cle = ?").run(ns, cle);
    return json({ ok: true, namespace: ns, cle, supprime: info.changes }, req);
  }

  return json({ erreur: "méthode non permise" }, req, 405);
}

/** Enregistre la route `/kv` dans le routeur (préfixe → dispatch interne par méthode). */
export function enregistrerKv(routeur: Routeur): void {
  routeur.enregistrerPrefixe("/kv", (req, url) => traiterKv(req, url));
}
