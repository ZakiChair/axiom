import { configuredProviders, proxyNavigationForbidden, type ProxyEnv } from "./_policy.js";

/** Disponibilité uniquement : aucun secret ni fragment de secret n'est sérialisé. */
export function handleConfig(request: Request, env: ProxyEnv = process.env): Response {
  const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
  if (request.method !== "GET") return Response.json({ erreur: "méthode non autorisée" }, { status: 405, headers: { ...headers, allow: "GET" } });
  if (proxyNavigationForbidden(request.headers)) return Response.json({ erreur: "destination navigateur refusée" }, { status: 403, headers });
  return Response.json({ providers: configuredProviders(env) }, { headers });
}

export default { fetch: (request: Request): Response => handleConfig(request) };
