/**
 * Titre des options d'alerte Funding, CVD S/P et Cascade liq désactivées (panneau Alertes), repris par
 * le refus à la soumission. PURES, testées sans DOM ; chargées avec le panneau seulement.
 */
import type { ExchangeId } from "@axiom/types";
import { raisonAlertesSansPerp, TYPES_ALERTE_PERP } from "./sansPerp.util";

/**
 * `null` : options permises pour la cible {source du graphe, symbole saisi ou composé}. Sur un graphe
 * Twelve Data, une cible que le routage n'envoie pas vers la crypto est refusée sans être jugée : les
 * perps cotés USD1 ou U (BTCUSD1, BTCU), absents de QUOTE_ASSETS, y restent exclus (résidu accepté).
 * Le titre dit donc d'où l'alerte est indisponible, sans nier le marché perp.
 */
export function titreOptionsPerp(exchange: ExchangeId, symbol: string): string | null {
  const raison = raisonAlertesSansPerp(exchange, symbol);
  return raison !== null && exchange === "twelvedata"
    ? "Indisponible depuis un graphe Twelve Data : ouvrez la paire crypto pour créer cette alerte."
    : raison;
}

/**
 * Contrôle défensif d'une création (type simple ou sous-conditions d'une composée) : le type choisi
 * survit à un changement de graphe, l'option désactivée ne suffit pas. Même texte que le titre de
 * l'option. `null` : permis.
 */
export function refusAlertePerp(types: readonly string[], exchange: ExchangeId, symbol: string): string | null {
  return types.some((t) => TYPES_ALERTE_PERP.has(t)) ? titreOptionsPerp(exchange, symbol) : null;
}
