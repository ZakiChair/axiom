/**
 * Proxy des 4 APIs sans CORS / à clé, RÉPLIQUE EXACTE des proxys de dev Vite
 * (apps/web/vite.config.ts) pour que le chemin de PROD (daemon) soit iso au dev :
 *   /fredapi      → https://api.stlouisfed.org  (clé api_key si absente)
 *   /coinalyzeapi → https://api.coinalyze.net   (clé api_key si absente)
 *   /tdapi        → https://api.twelvedata.com  (apikey TOUJOURS ajoutée, cf. Vite)
 *   /mexcapi      → https://api.mexc.com        (keyless, simple réécriture de chemin)
 *
 * Rappel BUILD-CONTRACT : le daemon ne proxifie JAMAIS le chemin chaud (les WS de
 * marché du front restent DIRECTS). Ici, uniquement du REST à quota, mis en cache.
 */
import { cleCache, ecrireCache, lireCache, ttlMsPourChemin } from "./cache";
import { entetesCors } from "./cors";
import type { ProxyKeys } from "./env";
import type { Routeur } from "./router";

/**
 * Ajoute `<paramName>=<key>` à la query d'un chemin proxifié UNIQUEMENT si la
 * query n'en contient pas déjà une. Le proxy fournit une clé de repli (depuis
 * apps/web/.env) quand le front n'envoie aucune clé, mais une clé PERSONNELLE
 * déjà présente dans la query reste PRIORITAIRE et n'est jamais écrasée.
 *
 * COPIE VERBATIM de apps/web/src/data/apiKeyProxy.ts::appendApiKeyIfAbsent
 * (interdiction d'import cross-package apps/web ; source de vérité = ce commentaire).
 * Fonction PURE.
 */
export function appendApiKeyIfAbsent(path: string, paramName: string, key: string): string {
  if (key.length === 0) return path;
  const queryStart = path.indexOf("?");
  const query = queryStart === -1 ? "" : path.slice(queryStart + 1);
  const params = new URLSearchParams(query);
  if (params.has(paramName)) return path; // clé déjà fournie par le front → priorité à l'override
  const sep = queryStart === -1 ? "?" : "&";
  return `${path}${sep}${paramName}=${encodeURIComponent(key)}`;
}

/** Une route de proxy : préfixe entrant, amont, et réécriture du chemin. */
export interface RouteProxy {
  /** Préfixe entrant, ex. `/fredapi`. */
  prefix: string;
  /** Origine amont, ex. `https://api.stlouisfed.org`. */
  target: string;
  /** Réécriture : `chemin` = pathname+search commençant par `prefix` → chemin amont. */
  rewrite: (chemin: string) => string;
}

/**
 * Construit les 4 routes de proxy avec les clés injectées.
 * Chaque `rewrite` reproduit EXACTEMENT la réécriture du vite.config.ts correspondant.
 */
export function construireRoutesProxy(cles: ProxyKeys): RouteProxy[] {
  return [
    {
      prefix: "/fredapi",
      target: "https://api.stlouisfed.org",
      rewrite: (chemin) =>
        appendApiKeyIfAbsent(chemin.replace(/^\/fredapi/, ""), "api_key", cles.FRED_API_KEY),
    },
    {
      prefix: "/coinalyzeapi",
      target: "https://api.coinalyze.net",
      rewrite: (chemin) =>
        appendApiKeyIfAbsent(
          chemin.replace(/^\/coinalyzeapi/, ""),
          "api_key",
          cles.COINALYZE_API_KEY,
        ),
    },
    {
      // Twelve Data : Vite ajoute TOUJOURS `apikey` (pas de « si absente ») car le
      // front n'a pas de mécanisme d'override pour cette source → on réplique tel quel.
      prefix: "/tdapi",
      target: "https://api.twelvedata.com",
      rewrite: (chemin) => {
        const stripped = chemin.replace(/^\/tdapi/, "");
        const sep = stripped.includes("?") ? "&" : "?";
        return `${stripped}${sep}apikey=${cles.TWELVE_DATA_KEY}`;
      },
    },
    {
      prefix: "/mexcapi",
      target: "https://api.mexc.com",
      rewrite: (chemin) => chemin.replace(/^\/mexcapi/, ""),
    },
  ];
}

/**
 * Traite une requête proxifiée : cache GET (par préfixe), fetch amont, en-têtes
 * CORS + `X-Axiomd-Cache: hit|miss`. Les erreurs réseau renvoient un 502 propre
 * (le daemon ne plante pas).
 */
export async function traiterProxy(req: Request, url: URL, route: RouteProxy): Promise<Response> {
  const cheminEntrant = url.pathname + url.search;
  const urlAmont = route.target + route.rewrite(cheminEntrant);
  const cors = entetesCors(req);

  if (req.method === "GET") {
    const ttlMs = ttlMsPourChemin(url.pathname);
    const cle = cleCache("GET", cheminEntrant);
    if (ttlMs > 0) {
      const hit = lireCache(cle);
      if (hit) {
        return new Response(hit.corps, {
          headers: { "content-type": hit.contentType, "x-axiomd-cache": "hit", ...cors },
        });
      }
    }
    let amont: Response;
    try {
      amont = await fetch(urlAmont, { method: "GET" });
    } catch (err) {
      return reponseErreurAmont(err, cors);
    }
    const corps = new Uint8Array(await amont.arrayBuffer());
    const contentType = amont.headers.get("content-type") ?? "application/octet-stream";
    // On ne met en cache que les réponses valides (évite de figer une erreur transitoire).
    if (ttlMs > 0 && amont.ok) ecrireCache(cle, corps, contentType, ttlMs);
    return new Response(corps, {
      status: amont.status,
      headers: { "content-type": contentType, "x-axiomd-cache": "miss", ...cors },
    });
  }

  // Méthodes non-GET (rare pour ces APIs de lecture) : transfert direct, sans cache.
  const corpsReq = req.method === "HEAD" ? undefined : await req.arrayBuffer();
  let amont: Response;
  try {
    amont = await fetch(urlAmont, {
      method: req.method,
      body: corpsReq && corpsReq.byteLength > 0 ? corpsReq : undefined,
      headers: req.headers.get("content-type")
        ? { "content-type": req.headers.get("content-type") as string }
        : undefined,
    });
  } catch (err) {
    return reponseErreurAmont(err, cors);
  }
  const corps = new Uint8Array(await amont.arrayBuffer());
  return new Response(corps, {
    status: amont.status,
    headers: {
      "content-type": amont.headers.get("content-type") ?? "application/octet-stream",
      "x-axiomd-cache": "miss",
      ...cors,
    },
  });
}

function reponseErreurAmont(err: unknown, cors: Record<string, string>): Response {
  const message = err instanceof Error ? err.message : String(err);
  return new Response(JSON.stringify({ erreur: "amont injoignable", detail: message }), {
    status: 502,
    headers: { "content-type": "application/json; charset=utf-8", ...cors },
  });
}

/** Enregistre les 4 routes de proxy dans le routeur. */
export function enregistrerProxy(routeur: Routeur, cles: ProxyKeys): void {
  for (const route of construireRoutesProxy(cles)) {
    routeur.enregistrerPrefixe(route.prefix, (req, url) => traiterProxy(req, url, route));
  }
}
