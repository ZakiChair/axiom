/**
 * Pont calendrier ECO → série du catalogue macro. Fonction PURE.
 *
 * `ECO` annonçait la publication du CPI américain — sa date, sa prévision, sa valeur
 * précédente — sans jamais pouvoir en montrer l'historique. Ce module fournit la cible
 * du bouton « série » de la ligne du calendrier.
 *
 * Les motifs de titre reprennent la convention déjà employée par `impactPublicationFred`
 * (data/eco.ts) : reconnaissance par mots-clés sur le titre ForexFactory, jamais par
 * identifiant — les titres varient d'une semaine à l'autre.
 */
import { CATALOGUE_MACRO, type RegionMacro } from "./catalogueMacro";

/** Devise ForexFactory → zone du catalogue. Les devises absentes ne sont pas suivies. */
const DEVISE_VERS_REGION: Record<string, RegionMacro> = {
  USD: "US",
  EUR: "EZ",
  GBP: "UK",
  JPY: "JP",
  CNY: "CN",
  INR: "IN",
};

/** Mots-clés de titre → indicateur du catalogue. Premier motif trouvé l'emporte. */
const MOTIFS: ReadonlyArray<{ motif: RegExp; indicateur: "cpi-aa" }> = [
  { motif: /\bcpi\b|consumer price index/i, indicateur: "cpi-aa" },
];

/**
 * Identifiant de série correspondant à une ligne du calendrier, ou `null` si la
 * publication n'a pas de série suivie (auquel cas aucun bouton n'est rendu).
 */
export function serieMacroDe(country: string, title: string): string | null {
  const region = DEVISE_VERS_REGION[country.trim().toUpperCase()];
  if (region === undefined) return null;

  const titre = title.trim();
  for (const { motif, indicateur } of MOTIFS) {
    if (!motif.test(titre)) continue;
    const def = CATALOGUE_MACRO.find((d) => d.region === region && d.indicateur === indicateur);
    if (def !== undefined) return def.id;
  }
  return null;
}
