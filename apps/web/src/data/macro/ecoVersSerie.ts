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
import { CATALOGUE_MACRO, type RegionMacro, type IndicateurMacro } from "./catalogueMacro";

/** Devise ForexFactory → zone du catalogue. Les devises absentes ne sont pas suivies. */
const DEVISE_VERS_REGION: Record<string, RegionMacro> = {
  USD: "US",
  EUR: "EZ",
  GBP: "UK",
  JPY: "JP",
  CNY: "CN",
  INR: "IN", // ForexFactory n'émet jamais d'Inde ; ce mapping est actuellement inatteignable mais ferme correctement (retourne null)
  CAD: "CA",
  CHF: "CH",
};

/** Titres exacts : conserver mesure, fréquence et territoire. Les variantes nationales
 * non équivalentes (ex. CPI allemand, core japonais, PIB US annualisé q/q) n'ont
 * aucun raccourci vers une autre statistique. */
const MOTIFS: ReadonlyArray<{ motif: RegExp; indicateur: IndicateurMacro }> = [
  {
    motif: /^(cpi|consumer price index)(\s+flash estimate)?\s+y\/y$/i,
    indicateur: "cpi-aa",
  },
  { motif: /^(cpi|consumer price index)(\s+flash estimate)?\s+m\/m$/i, indicateur: "cpi-mm" },
  { motif: /^core (cpi|consumer price index)(\s+flash estimate)?\s+y\/y$/i, indicateur: "core-cpi-aa" },
  { motif: /^(ppi|producer price index)\s+y\/y$/i, indicateur: "ppi-aa" },
  { motif: /^(?:prelim |final |flash )?gdp\s+y\/y$/i, indicateur: "pib-aa" },
  { motif: /^unemployment rate$/i, indicateur: "chomage" },
  { motif: /^industrial production\s+y\/y$/i, indicateur: "production-aa" },
  { motif: /^m2 money supply\s+y\/y$/i, indicateur: "monnaie-aa" },
  { motif: /^unemployment claims$/i, indicateur: "demandes-chomage" },
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
  // SECO mensuel ≠ chômage par enquête OCDE trimestriel.
  if (region === "CH" && /^unemployment rate$/i.test(titre)) return null;
  // Au Royaume-Uni et au Canada, GDP y/y peut désigner le PIB mensuel.
  if ((region === "UK" || region === "CA") && /gdp\s+y\/y$/i.test(titre)) return null;
  for (const { motif, indicateur } of MOTIFS) {
    if (!motif.test(titre)) continue;
    const def = CATALOGUE_MACRO.find((d) => d.region === region && d.indicateur === indicateur);
    if (indicateur === "monnaie-aa" && !def?.perimetre?.startsWith("M2 ·")) return null;
    if (def !== undefined && def.source.transport !== "indisponible") return def.id;
  }
  return null;
}
