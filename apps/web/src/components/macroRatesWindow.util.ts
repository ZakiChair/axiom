/**
 * Fonctions PURES de la fenêtre RATE (`MacroRatesWindow.tsx`), extraites du composant
 * pour rester testables indépendamment (le composant importe `CourbeTaux` → `store/theme`
 * qui touche le DOM à l'import — même convention que `courbeTaux.util.ts`).
 */
import type { RendementsSouverainsMulti } from "../data/macro/sovereignYields";

/**
 * Pays attendus de l'onglet Rendements restés sans AUCUNE donnée après chargement —
 * libellés affichés en pied d'onglet (dégradation VISIBLE : sans cette note, un pays
 * en panne disparaît en silence, cf. RBA 403 Akamai documenté dans sovereignYields.ts).
 * Renvoie [] tant que rien n'est chargé (data null). Fonction PURE (testée).
 */
export function paysIndisponibles(data: RendementsSouverainsMulti | null): string[] {
  if (data === null) return [];
  const vides: string[] = [];
  if (data.us.length === 0) vides.push("US");
  if (Object.keys(data.euro).length === 0) vides.push("Zone euro");
  if (data.jp.length === 0) vides.push("Japon");
  if (data.ca.length === 0) vides.push("Canada");
  if (data.au.length === 0) vides.push("Australie");
  return vides;
}
