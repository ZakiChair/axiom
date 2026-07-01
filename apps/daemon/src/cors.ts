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
]);

/**
 * Détermine l'Origin à renvoyer, ou `null` si aucune (requête same-origin sans
 * en-tête Origin, ou origine non autorisée). Fonction PURE (testable).
 */
export function origineAutorisee(origin: string | null, host: string | null): string | null {
  if (!origin) return null; // même-origine (navigation directe) ou client non-navigateur
  if (ORIGINES_DEV.has(origin)) return origin;
  // Same-origin en prod : le front servi par le daemon partage son host.
  if (host && (origin === `http://${host}` || origin === `https://${host}`)) return origin;
  return null;
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
