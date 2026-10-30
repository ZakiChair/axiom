/**
 * Vues adossées à un marché perp (alertes Funding/CVD/Cascade, fenêtre LIQ) quand le graphe n'en
 * a pas : raisons affichées, PURES et testées sans DOM. Chargé avec ces vues seulement (hors
 * chunk d'entrée) ; les prédicats eux-mêmes vivent dans store/market.ts : `sansMarchePerp` pour le
 * graphe (fenêtre LIQ), `sansMarchePerpCible` pour une cible d'alerte.
 */
import type { ExchangeId } from "@axiom/types";
import { sansMarchePerp, sansMarchePerpCible } from "../store/market";

/** Types d'alerte adossés à un perp : funding, CVD spot/perp, cascade de liquidations. */
export const TYPES_ALERTE_PERP: ReadonlySet<string> = new Set(["funding-extreme", "cvd-spot-perp-div", "liq-cascade"]);

/**
 * Refus des types perp sur une cible sans marché perp (source du graphe, symbole saisi : voir
 * `sansMarchePerpCible`) : raison du titre de l'option désactivée et du refus à la soumission (le
 * type choisi survit à un changement de graphe). Sur un graphe Twelve Data, ce texte vient de
 * `titreOptionsPerp`. `null` : permis.
 */
export function raisonAlertesSansPerp(exchange: ExchangeId, symbol: string): string | null {
  return sansMarchePerpCible(exchange, symbol)
    ? `Pas de marché perp pour ${symbol} : alertes Funding, CVD S/P et Cascade liq indisponibles.`
    : null;
}

/** Message de la fenêtre LIQ à la place d'une attente sans fin ; `null` sur un perp. */
export function raisonLiqSansPerp(exchange: ExchangeId, symbol: string): string | null {
  return sansMarchePerp(exchange, symbol) ? "Pas de marché perp pour cette série : liquidations indisponibles." : null;
}
