/**
 * Helpers PURS du panneau Alertes (AlertsPanel.tsx) : catalogue et construction de
 * la condition `indicateur-croisement` du formulaire, et résolution de la cible de
 * navigation d'un déclenchement du journal. Extraits ici pour être testables sans DOM.
 */
import type { AlertDef, Condition, SensCroisement } from "@axiom/alerts";
import { INDICATORS, getIndicator } from "@axiom/indicators";
import type { ExchangeId, IndicatorDef } from "@axiom/types";

/**
 * Indicateurs éligibles au croisement : calculables sur bougies seules (pas de série
 * aux, comme `indicateur-seuil`) ET exposant au moins DEUX sorties à croiser
 * (ex. MACD : macd × signal).
 */
export const INDICATEURS_CROISEMENT: IndicatorDef[] = INDICATORS.filter(
  (d) => (!d.aux || d.aux.length === 0) && d.outputs.length >= 2,
);

/**
 * Construit la condition `indicateur-croisement` depuis l'état du formulaire, ou
 * `null` si la saisie est invalide (indicateur inconnu, sortie absente, ou deux fois
 * la même sortie — le moteur comparerait une série à elle-même et ne déclencherait jamais).
 * Params vides → défauts du registry côté moteur (comme `indicateur-seuil`).
 */
export function construireConditionCroisement(
  indicateurId: string,
  outputA: string,
  outputB: string,
  sens: SensCroisement,
): Condition | null {
  if (outputA === outputB) return null;
  const idef = getIndicator(indicateurId);
  if (!idef) return null;
  const cles = new Set(idef.outputs.map((o) => o.key));
  if (!cles.has(outputA) || !cles.has(outputB)) return null;
  return { type: "indicateur-croisement", indicateurId, params: {}, outputA, outputB, sens };
}

/**
 * Cible de navigation d'un déclenchement du journal : le journal ne porte que
 * l'`alertId`, le symbole vit sur la def. `null` si la def a été supprimée depuis.
 */
export function cibleAlerte(
  defs: readonly AlertDef[],
  alertId: string,
): { symbol: string; source: ExchangeId } | null {
  const def = defs.find((d) => d.id === alertId);
  return def ? { symbol: def.symbol, source: def.source } : null;
}
