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
import { createFredM2Provider, ErreurHttpFred } from "./fred";
import { differenceDatesCommunes, variationPeriode } from "./harmonisation";
import { chargerSerieNbs } from "./nbs";
import { chargerSerieMospi } from "./mospi";
import { chargerSerieStatcan } from "./statcan";
import { chargerSerieBoj } from "./boj";

/** Issue d'un chargement de série. Aucune exception ne franchit cette frontière. */
export type ResultatSerieMacro =
  | { statut: "ok"; points: MacroSeries }
  | { statut: "quota" | "sansCle" | "panne" | "indisponible"; message: string }
  | { statut: "annule" };

/**
 * Clé de santé d'une définition : UNE par hôte, jamais par série — le panneau DATA
 * nomme des fournisseurs, pas des observations.
 */
export function cleSante(def: DefinitionSerieMacro): string {
  return `macro:${def.source.transport === "ecartFred" ? "fred" : def.source.transport}`;
}

/** Charge une série et normalise toute défaillance en statut lisible. */
export async function chargerSerieMacro(
  def: DefinitionSerieMacro,
  depuisMs: number,
  signal?: AbortSignal,
): Promise<ResultatSerieMacro> {
  if (signal?.aborted) return { statut: "annule" };
  if (def.source.transport === "indisponible") return { statut: "indisponible", message: def.source.motif };
  const debut = new Date(depuisMs);
  if (def.transformation) debut.setUTCMonth(debut.getUTCMonth() - (def.transformation === "aa" ? 12 : 1), 1);
  const depuisSource = debut.getTime();
  try {
    const source = def.source;
    let points: MacroSeries;
    switch (source.transport) {
      case "fred": {
        points = await createFredM2Provider(source.seriesId, source.units).fetchSeries({
          start: depuisSource,
          signal,
        });
        break;
      }
      case "ecartFred": {
        const [gauche, droite] = await Promise.all([source.gauche, source.droite].map((id) =>
          createFredM2Provider(id).fetchSeries({ start: depuisSource, signal })));
        points = differenceDatesCommunes(gauche ?? [], droite ?? [], source.facteur);
        break;
      }
      case "oecd":
        points = await chargerSerieOecd(source.dataflow, source.cle, depuisSource, signal);
        break;
      case "eurostat":
        points = await chargerSerieEurostat(source.dataset, source.filtres, depuisSource, signal);
        break;
      case "ons":
        points = await chargerSerieOns(source.chemin, depuisSource, signal, def.frequence);
        break;
      case "nbs":
        points = await chargerSerieNbs(source.serie, depuisSource, signal);
        break;
      case "mospi":
        points = await chargerSerieMospi(source.serie, depuisSource, signal);
        break;
      case "statcan":
        points = await chargerSerieStatcan(source.vectorId, depuisSource, signal);
        break;
      case "boj":
        points = await chargerSerieBoj(source.code, depuisSource, signal);
        break;
    }
    if (signal?.aborted) return { statut: "annule" };
    if (def.transformation) points = variationPeriode(points, def.transformation === "aa" ? 12 : 1);
    points = points.filter((p) => p.time >= depuisMs && p.time <= Date.now());
    if (points.length === 0) {
      return { statut: "panne", message: "Source sans donnée sur la période." };
    }
    return { statut: "ok", points };
  } catch (e) {
    if (signal?.aborted || (e instanceof Error && e.name === "AbortError")) return { statut: "annule" };
    if (e instanceof ErreurQuotaOecd) {
      return { statut: "quota", message: "Quota OCDE — nouvelle tentative différée." };
    }
    if (e instanceof ErreurHttpFred && e.statut === 429) return { statut: "quota", message: "Quota FRED — réessayer plus tard." };
    // FRED sans clé répond 401 : ce n'est pas une panne, c'est une configuration absente.
    // ErreurHttpFred porte le statut HTTP typé — on ne scrute pas le message.
    if (def.cleRequise && e instanceof ErreurHttpFred && e.statut === 401) {
      return { statut: "sansCle", message: "Clé FRED absente." };
    }
    return { statut: "panne", message: "Source indisponible." };
  }
}
