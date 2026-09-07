/**
 * Fonctions PURES de projection des maturités pour `CourbeTaux.tsx`, extraites du
 * composant canvas (lui-même non unit-testé, cf. convention `Sparkline`/
 * `SeasonalityWindow`) pour rester testables indépendamment.
 */
import type { PointCourbe } from "./CourbeTaux";
import type { MacroSeries } from "../data/macro/types";

/**
 * `anneesDeMaturite` — conversion PURE d'un libellé de maturité de la courbe des taux
 * (« 1 Mo », « 1.5 Month », « 10 Yr »…) en nombre d'années (fraction pour les mois).
 *
 * Les libellés reconnus sont « N Mo », le cas irrégulier « 1.5 Month » (CSV du Trésor
 * US) et « N Yr » (axe commun à tous les pays — cf. `treasuryYields.ts` et
 * `sovereignYields.ts`). Toute forme inconnue (ex. « 10 Yr (indexée) », rendement RÉEL
 * australien à ne pas tracer sur la courbe nominale) renvoie `NaN`.
 */
export function anneesDeMaturite(m: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(Mo|Month|Yr)$/i.exec(m.trim());
  if (!match) return NaN;
  const valeur = Number(match[1]);
  const unite = match[2]!.toLowerCase();
  return unite === "yr" ? valeur : valeur / 12;
}

/**
 * Projette une observation de courbe (`rendements` : taux % par libellé de maturité)
 * en points de `CourbeTaux`, dans l'ordre de `maturites`. Les maturités absentes de
 * l'observation et les libellés non convertibles en années (`anneesDeMaturite` → NaN,
 * ex. obligation indexée) sont écartés — dégradation gracieuse. Fonction PURE.
 */
export function pointsDeCourbe(
  rendements: Record<string, number> | undefined,
  maturites: readonly string[],
): PointCourbe[] {
  if (rendements === undefined) return [];
  const pts: PointCourbe[] = [];
  for (const m of maturites) {
    const taux = rendements[m];
    const annees = anneesDeMaturite(m);
    if (taux !== undefined && Number.isFinite(annees)) {
      pts.push({ maturite: m, anneesTri: annees, taux });
    }
  }
  return pts;
}

/** Mois abrégés FR — mêmes libellés que le reste du terminal. */
const MOIS_ABREGES: readonly string[] = [
  "janv.",
  "févr.",
  "mars",
  "avr.",
  "mai",
  "juin",
  "juil.",
  "août",
  "sept.",
  "oct.",
  "nov.",
  "déc.",
];

/**
 * Projette une série TEMPORELLE en points de `CourbeTaux`, dont l'axe X (`anneesTri`)
 * accepte n'importe quel flottant : on y met des années décimales. Cela évite d'écrire
 * un second composant canvas — au prix de deux contraintes portées par l'appelant :
 *
 *   1. UN GRAPHE = UNE FRÉQUENCE. L'infobulle de `CourbeTaux` apparie les points par
 *      identité de chaîne sur `maturite` : mélanger du mensuel et du trimestriel
 *      remplirait les colonnes de « — ».
 *   2. UN GRAPHE = DES POURCENTAGES. L'axe Y de `CourbeTaux` formate en dur avec « % ».
 *
 * Fonction PURE.
 */
export function pointsDeSerieTemporelle(serie: MacroSeries): PointCourbe[] {
  const pts: PointCourbe[] = [];
  for (const p of serie) {
    if (!Number.isFinite(p.time) || !Number.isFinite(p.value)) continue;
    const d = new Date(p.time);
    const annee = d.getUTCFullYear();
    const mois = d.getUTCMonth();
    // Années décimales : l'axe n'a besoin que de la monotonie et d'un espacement juste.
    const anneesTri = annee + mois / 12;
    const libelleMois = MOIS_ABREGES[mois] ?? String(mois + 1);
    pts.push({
      maturite: `${libelleMois} ${String(annee).slice(2)}`,
      anneesTri,
      taux: p.value,
    });
  }
  return pts;
}
