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
  INR: "IN", // ForexFactory n'émet jamais d'Inde ; ce mapping est actuellement inatteignable mais ferme correctement (retourne null)
};

/**
 * Motif de titre pour CPI titre → indicateur du catalogue. Reconnaissance exacte,
 * non par sous-chaîne : la catalogue ne contient QUE l'indice titre (headline),
 * annuel (y/y). Un bouton vers Core, m/m, ou variant régional ferait mentir l'UI
 * silencieusement. Appariement par ALLOW-LIST plutôt que deny-list : ancrée à ^…$
 * contre le titre normalisé (trimé, espaces internes réduits, minuscules), elle
 * reste robuste contre des intitulés inconnus. Les quatre vraies sources FF du 2026-09-07
 * qui ne correspondent PAS : "German Final CPI m/m", "Core CPI y/y", "Core CPI m/m",
 * "CPI m/m" — preuve que la sous-chaîne était trop large.
 */
const MOTIFS: ReadonlyArray<{ motif: RegExp; indicateur: "cpi-aa" }> = [
  {
    motif: /^(cpi|consumer price index)(\s+flash estimate)?\s+y\/y$/i,
    indicateur: "cpi-aa",
  },
];

/**
 * Identifiant de série correspondant à une ligne du calendrier, ou `null` si la
 * publication n'a pas de série suivie (auquel cas aucun bouton n'est rendu).
 */
export function serieMacroDe(country: string, title: string): string | null {
  const region = DEVISE_VERS_REGION[country.trim().toUpperCase()];
  if (region === undefined) return null;

  // Normaliser le titre : trimmer, réduire les espaces internes, minuscules pour le regex
  const titre = title.trim().replace(/\s+/g, " ");
  for (const { motif, indicateur } of MOTIFS) {
    if (!motif.test(titre)) continue;
    const def = CATALOGUE_MACRO.find((d) => d.region === region && d.indicateur === indicateur);
    if (def !== undefined) return def.id;
  }
  return null;
}
