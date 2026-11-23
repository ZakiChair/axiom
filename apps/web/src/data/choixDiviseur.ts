/**
 * Logique pure du sélecteur « Autre actif… » (diviser le marché affiché par un actif du
 * catalogue). Importée seulement par le sélecteur chargé à la demande : ce module reste
 * hors du chargement initial — d'où les messages de refus ici, et non dans `ratio.ts`, dont
 * `estRatio` (chargement initial) ne lit que le cœur sans texte `composerRatioLibreCode`.
 */
import { composerRatioLibreCode, REFS, REFS_TRADFI, symboleRatio, type DenominateurId, type JambeChoisie } from "./ratio";
import { searchMarkets, type MarketCandidate, type MarketCatalog } from "./marketRouting";
import type { ExchangeId, Timeframe } from "@axiom/types";

/** Ratio libre composé (`denom` non nul = dénominateur fixe reconnu), ou refus à afficher tel quel. */
export type ResultatRatioLibre = { symbole: string; denom: DenominateurId | null } | { refus: string };

/** Règles 2 à 4 de la spec (§5.2) seules : jambe B, A ÷ A, devise ; les codes du cœur deviennent des messages. PURE. */
export function composerRatioLibre(baseSym: string, baseEx: ExchangeId, jambe: JambeChoisie): ResultatRatioLibre {
  const libre = composerRatioLibreCode(baseSym, baseEx, jambe);
  if ("symbole" in libre) return { symbole: libre.symbole, denom: null };
  switch (libre.code) {
    case "serie": return { refus: "Série en % ou déjà composée : pas un diviseur" };
    case "compose": return { refus: "Graphique composé : revenez à un actif simple" };
    case "meme": return { refus: "Même actif que le graphique" };
    case "devise": return { refus: "Devise de cotation inconnue" };
    case "devises": return { refus: `Devises différentes (${libre.a} contre ${libre.b})` };
  }
}

/** Dénominateur fixe dont `jambe` est la référence sur sa place, sinon null. PURE. */
export function referenceFixe(jambe: JambeChoisie): DenominateurId | null {
  if (jambe.exchange === "twelvedata") {
    const trouve = (Object.keys(REFS_TRADFI) as Array<keyof typeof REFS_TRADFI>).find((id) => REFS_TRADFI[id].sym === jambe.symbol);
    return trouve ?? null;
  }
  const trouve = (Object.keys(REFS) as Array<keyof typeof REFS>).find((id) => REFS[id][jambe.exchange] === jambe.symbol);
  return trouve ?? null;
}

/** Règle 1 (fixe par référence), sinon `composerRatioLibre`. PURE. */
export function symboleRatioLibre(baseSym: string, baseEx: ExchangeId, jambe: JambeChoisie): ResultatRatioLibre {
  const d = referenceFixe(jambe);
  if (d !== null) {
    const fixe = symboleRatio(baseSym, baseEx, d);
    if (fixe !== null) return { symbole: fixe, denom: d };
  }
  return composerRatioLibre(baseSym, baseEx, jambe);
}

/** Option du sélecteur : un résultat de la recherche commune et sa composition contre la base. */
export interface OptionDiviseur { candidat: MarketCandidate; resultat: ResultatRatioLibre }

/**
 * Recherche commune (toutes sources, une place par ticker comme `searchMarkets`), chaque résultat
 * composé contre la base par `symboleRatioLibre` ; requête vide → []. PURE.
 */
export function optionsDiviseur(
  catalog: MarketCatalog,
  requete: string,
  base: { symbol: string; exchange: ExchangeId },
  timeframe: Timeframe,
  limite?: number,
): OptionDiviseur[] {
  if (!requete.trim()) return [];
  return searchMarkets(catalog, requete, limite ?? 30, timeframe).map((candidat) => ({
    candidat,
    resultat: symboleRatioLibre(base.symbol, base.exchange, { exchange: candidat.exchange, symbol: candidat.symbol }),
  }));
}
