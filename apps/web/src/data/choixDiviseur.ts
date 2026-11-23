/**
 * Logique pure du sélecteur « Autre actif… » (diviser le marché affiché par un actif du
 * catalogue). Importée seulement par le sélecteur chargé à la demande : ce module reste
 * hors du chargement initial.
 */
import type { DenominateurId, JambeChoisie, ResultatRatioLibre } from "./ratio";
import { composerRatioLibre, REFS, REFS_TRADFI, symboleRatio } from "./ratio";
import type { ExchangeId } from "@axiom/types";

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
