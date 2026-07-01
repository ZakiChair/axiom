/**
 * Injection de clé API côté PROXY de dev Vite (voir vite.config.ts).
 *
 * Ajoute `<paramName>=<key>` à la query d'un chemin proxifié UNIQUEMENT si la query
 * n'en contient pas déjà une. But : le proxy fournit une clé de repli (lue dans
 * apps/web/.env, gitignored) quand le front n'envoie aucune clé, mais une clé
 * PERSONNELLE envoyée par le front (déjà présente dans la query) reste PRIORITAIRE
 * et n'est jamais écrasée. La clé de repli ne transite donc que côté serveur de dev,
 * jamais dans le bundle navigateur (même principe que la clé Twelve Data / /tdapi).
 *
 * `key` vide (=> variable .env absente) : on n'ajoute rien et on laisse l'amont
 * répondre 401 — l'UI existante affiche alors un message d'erreur clair.
 *
 * Fonction PURE (aucun effet de bord) → testée unitairement (apiKeyProxy.test.ts).
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
