/**
 * Service statique du build front (chemin de PROD du daemon).
 *
 * Sert `apps/web/dist` avec repli SPA sur `index.html`. Si le build est absent, la
 * racine renvoie un message clair (le daemon reste vivant, /health répond toujours).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Dossier du build front (module-relatif → indépendant du cwd). */
export const CHEMIN_DIST = join(import.meta.dir, "..", "..", "web", "dist");

/** Le build front est-il présent (index.html) ? */
export function distExiste(): boolean {
  return existsSync(join(CHEMIN_DIST, "index.html"));
}

/**
 * Sert un fichier du build ou l'index en repli SPA.
 * - Build absent → 503 + message d'aide.
 * - Fichier présent → renvoyé tel quel (Bun infère le content-type).
 * - Fichier absent → index.html (routing client SPA).
 */
export async function servirStatique(url: URL): Promise<Response> {
  if (!distExiste()) {
    return new Response(
      "AXIOM daemon : build front absent. Lance d'abord : pnpm --filter @axiom/web build",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  // Garde anti-traversée : url.pathname est déjà normalisé par URL, mais on refuse
  // toute occurrence résiduelle de `..` par prudence.
  if (url.pathname.includes("..")) {
    return new Response("Chemin invalide", { status: 400 });
  }

  const chemin = url.pathname === "/" ? "/index.html" : url.pathname;
  const fichier = Bun.file(join(CHEMIN_DIST, chemin));
  if (await fichier.exists()) return new Response(fichier);

  // Repli SPA : toute route inconnue rend l'index (routing côté client).
  return new Response(Bun.file(join(CHEMIN_DIST, "index.html")));
}
