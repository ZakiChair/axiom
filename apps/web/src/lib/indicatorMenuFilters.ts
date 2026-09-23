/** Filtres cumulables du catalogue, indépendants du rendu et de la persistance. */
import type { IndicatorDef } from "@axiom/types";

export interface FiltresCatalogueIndicateurs {
  recherche: string;
  favorisSeulement: boolean;
  recentsSeulement: boolean;
  utilisablesSeulement: boolean;
  favoris: readonly string[];
  recents: readonly string[];
  correspondRecherche: (def: IndicatorDef, query: string) => boolean;
  utilisable: (def: IndicatorDef) => boolean;
}

export function filtrerCatalogueIndicateurs(
  defs: readonly IndicatorDef[], filtres: FiltresCatalogueIndicateurs,
): IndicatorDef[] {
  const favoris = new Set(filtres.favoris);
  const recents = new Map(filtres.recents.map((id, i) => [id, i]));
  const query = filtres.recherche.trim().toLowerCase();
  const resultats = defs.filter((def) =>
    (!filtres.favorisSeulement || favoris.has(def.id)) &&
    (!filtres.recentsSeulement || recents.has(def.id)) &&
    (!filtres.utilisablesSeulement || filtres.utilisable(def)) &&
    (!query || filtres.correspondRecherche(def, query)));
  if (filtres.recentsSeulement) resultats.sort((a, b) => (recents.get(a.id) ?? Infinity) - (recents.get(b.id) ?? Infinity));
  return resultats;
}
