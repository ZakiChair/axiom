/**
 * CORS du daemon.
 *
 * En DEV, le front tourne sous Vite (http://localhost:5173, +5174/5175 si le port
 * est pris) et appelle le daemon sur un autre port (8787) → requêtes cross-origin
 * qui nécessitent `Access-Control-Allow-Origin`.
 *
 * En PROD, le front est servi par le daemon lui-même → same-origin, aucune règle
 * CORS n'est requise (on écho tout de même l'Origin same-origin par cohérence).
 */

/** Origines de dev autorisées (Vite choisit 5173 puis 5174/5175 si occupé). */
export const ORIGINES_DEV: ReadonlySet<string> = new Set([
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://127.0.0.1:5175",
]);

const HOTES_LOCAUX: ReadonlySet<string> = new Set(["127.0.0.1", "localhost"]);

/** Parse strictement `localhost|127.0.0.1` avec un port décimal canonique optionnel. */
function autoriteLocale(host: string | null): string | null {
  if (!host) return null;
  const match = /^(localhost|127\.0\.0\.1)(?::([0-9]{1,5}))?$/i.exec(host);
  if (!match) return null;
  const hote = (match[1] ?? "").toLowerCase();
  if (!HOTES_LOCAUX.has(hote)) return null;
  const portBrut = match[2];
  if (portBrut === undefined) return hote;
  const port = Number(portBrut);
  if (!Number.isInteger(port) || port < 1 || port > 65_535 || String(port) !== portBrut) return null;
  return `${hote}:${port}`;
}

/** Refuse notamment un Host arbitraire utilisé lors d'un DNS rebinding. */
export function hostAutorise(host: string | null): boolean {
  return autoriteLocale(host) !== null;
}

/**
 * Détermine l'Origin à renvoyer, ou `null` si aucune (requête same-origin sans
 * en-tête Origin, ou origine non autorisée). Fonction PURE (testable).
 */
export function origineAutorisee(origin: string | null, host: string | null): string | null {
  if (!origin) return null; // même-origine (navigation directe) ou client non-navigateur
  if (ORIGINES_DEV.has(origin)) return origin;
  // Same-origin en prod : le front servi par le daemon partage son host.
  const autorite = autoriteLocale(host);
  if (autorite && (origin === `http://${autorite}` || origin === `https://${autorite}`)) return origin;
  return null;
}

/**
 * Garde d'entrée du daemon. CORS seul ne bloque pas les effets de bord : une origine
 * interdite doit être rejetée avant le routage, et le Host doit rester local.
 */
export function requeteLocaleAutorisee(req: Request): boolean {
  const host = req.headers.get("host");
  if (!hostAutorise(host)) return false;
  const origin = req.headers.get("origin");
  if (origin !== null && origineAutorisee(origin, host) === null) return false;
  // Les clients non navigateur n'envoient pas Origin. Un navigateur cross-site, lui,
  // annonce son contexte ; on bloque ce cas même si un intermédiaire a retiré Origin.
  if (origin === null && req.headers.get("sec-fetch-site") === "cross-site") return false;
  return true;
}

/** En-têtes CORS à greffer sur une réponse (vide si aucune origine autorisée). */
export function entetesCors(req: Request): Record<string, string> {
  const origin = origineAutorisee(req.headers.get("origin"), req.headers.get("host"));
  if (!origin) return {};
  return {
    "access-control-allow-origin": origin,
    vary: "origin",
  };
}

/** Réponse à un préflight OPTIONS. */
export function reponsePreflight(req: Request): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...entetesCors(req),
      // PUT/DELETE ajoutés en Phase 2.E2 : le store /kv accepte l'upsert (PUT) et la
      // suppression (DELETE), qui déclenchent un préflight en cross-origin (dev).
      "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
    },
  });
}
