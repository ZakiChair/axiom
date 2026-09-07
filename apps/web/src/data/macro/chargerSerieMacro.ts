/**
 * Aiguillage transport → chargeur, et normalisation du résultat.
 *
 * Le store n'a besoin de connaître ni les URL, ni les formats, ni les codes HTTP : il
 * reçoit un résultat typé. La distinction « quota » / « sans clé » / « panne » est faite
 * ICI, parce que c'est elle qui décide du message affiché — et la règle produit est
 * qu'une absence n'est jamais muette, ni maquillée en panne.
 */
import type { MacroSeries } from "./types";
import type { DefinitionSerieMacro } from "./catalogueMacro";
import { chargerSerieEurostat } from "./eurostat";
import { chargerSerieOecd, ErreurQuotaOecd } from "./oecd";
import { chargerSerieOns } from "./ons";
import { createFredM2Provider } from "./fred";

/** Issue d'un chargement de série. Aucune exception ne franchit cette frontière. */
export type ResultatSerieMacro =
  | { statut: "ok"; points: MacroSeries }
  | { statut: "quota" | "sansCle" | "panne"; message: string };

/**
 * Clé de santé d'une définition : UNE par hôte, jamais par série — le panneau DATA
 * nomme des fournisseurs, pas des observations.
 */
export function cleSante(def: DefinitionSerieMacro): string {
  return `macro:${def.source.transport}`;
}

/** Charge une série et normalise toute défaillance en statut lisible. */
export async function chargerSerieMacro(
  def: DefinitionSerieMacro,
  depuisMs: number,
  signal?: AbortSignal,
): Promise<ResultatSerieMacro> {
  try {
    const source = def.source;
    let points: MacroSeries;
    switch (source.transport) {
      case "fred": {
        points = await createFredM2Provider(source.seriesId, source.units).fetchSeries({
          start: depuisMs,
          signal,
        });
        break;
      }
      case "oecd":
        points = await chargerSerieOecd(source.dataflow, source.cle, depuisMs, signal);
        break;
      case "eurostat":
        points = await chargerSerieEurostat(source.dataset, source.filtres, depuisMs, signal);
        break;
      case "ons":
        points = await chargerSerieOns(source.chemin, depuisMs, signal);
        break;
    }
    if (points.length === 0) {
      return { statut: "panne", message: "Source sans donnée sur la période." };
    }
    return { statut: "ok", points };
  } catch (e) {
    if (e instanceof ErreurQuotaOecd) {
      return { statut: "quota", message: "Quota OCDE — nouvelle tentative différée." };
    }
    const texte = e instanceof Error ? e.message : String(e);
    // FRED sans clé répond 401 : ce n'est pas une panne, c'est une configuration absente.
    if (def.cleRequise && /\b401\b/.test(texte)) {
      return { statut: "sansCle", message: "Clé FRED absente." };
    }
    return { statut: "panne", message: "Source indisponible." };
  }
}
