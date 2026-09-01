/**
 * Routeur minimal du daemon.
 *
 * Chaque module (proxy aujourd'hui ; kv/alertes ajoutés par les agents suivants)
 * enregistre ses routes via `enregistrer`/`enregistrerPrefixe`. La première route
 * qui matche gère la requête ; si aucune ne matche, `gerer` renvoie `null` et
 * l'appelant (index.ts) retombe sur le service statique.
 */
import { entetesCors } from "./cors";

/** Gestionnaire d'une route : reçoit la requête et l'URL déjà parsée. */
export type GestionnaireRoute = (req: Request, url: URL) => Response | Promise<Response>;

/**
 * Enveloppe un gestionnaire : toute exception (typiquement SQLite — disque plein, base
 * corrompue) devient un 500 JSON CONVENTIONNEL avec en-têtes CORS, au lieu de remonter
 * jusqu'à `Bun.serve.error` (500 texte brut SANS CORS, illisible en cross-origin dev).
 * Même patron que la garde base documentée dans snapshots.ts (traiterSnapshots).
 */
export function avecGardeErreur(nom: string, gerer: GestionnaireRoute): GestionnaireRoute {
  return async (req, url) => {
    try {
      return await gerer(req, url);
    } catch (err) {
      console.error(`[axiomd] ${nom} — erreur interne :`, err);
      return new Response(JSON.stringify({ erreur: `erreur interne ${nom}` }), {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8", ...entetesCors(req) },
      });
    }
  };
}

/** Une route enregistrée : prédicat de correspondance + gestionnaire. */
export interface Route {
  correspond: (url: URL, req: Request) => boolean;
  gerer: GestionnaireRoute;
}

export class Routeur {
  private readonly routes: Route[] = [];

  /** Enregistre une route arbitraire (prédicat libre). */
  enregistrer(route: Route): void {
    this.routes.push(route);
  }

  /** Enregistre une route par correspondance de préfixe de pathname. */
  enregistrerPrefixe(prefixe: string, gerer: GestionnaireRoute): void {
    this.enregistrer({
      correspond: (url) => url.pathname === prefixe || url.pathname.startsWith(prefixe + "/"),
      gerer,
    });
  }

  /** Route la requête ; renvoie `null` si aucune route ne matche. */
  async gerer(req: Request, url: URL): Promise<Response | null> {
    for (const route of this.routes) {
      if (route.correspond(url, req)) return route.gerer(req, url);
    }
    return null;
  }
}
