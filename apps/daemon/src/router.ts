/**
 * Routeur minimal du daemon.
 *
 * Chaque module (proxy aujourd'hui ; kv/alertes ajoutés par les agents suivants)
 * enregistre ses routes via `enregistrer`/`enregistrerPrefixe`. La première route
 * qui matche gère la requête ; si aucune ne matche, `gerer` renvoie `null` et
 * l'appelant (index.ts) retombe sur le service statique.
 */

/** Gestionnaire d'une route : reçoit la requête et l'URL déjà parsée. */
export type GestionnaireRoute = (req: Request, url: URL) => Response | Promise<Response>;

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
