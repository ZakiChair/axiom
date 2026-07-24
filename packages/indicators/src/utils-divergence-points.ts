/**
 * @axiom/indicators — utils-divergence-points.ts
 *
 * Brique PURE partagée par les IndicatorDef `rsiDivergence` / `cvdDivergence`
 * (Task 3) : transforme les divergences prix↔oscillateur (Task 2) en 4 séries de
 * POINTS overlay, une par type, chaque point posé au `idxTo` de la divergence et
 * portant le PRIX à cet index (creux/`low` pour les familles haussières, sommet/
 * `high` pour les baissières). `undefined` partout ailleurs (aucun tracé).
 *
 * Deux appels distincts à `detecterDivergences` (cf. brief) :
 *   - sur les LOWS  → on ne retient que la famille HAUSSIÈRE (régulière + cachée) ;
 *   - sur les HIGHS → on ne retient que la famille BAISSIÈRE (régulière + cachée).
 * Chaque appel calcule aussi l'autre famille sur la même série de prix, mais on
 * l'ignore : une divergence baissière se lit sur les sommets, une haussière sur
 * les creux — pas sur la série adaptée à l'autre sens.
 */

import { detecterDivergences } from "./utils-divergence";

/**
 * `type` (et non `interface`) : l'alias d'objet reçoit une signature d'index
 * implicite, donc reste assignable à `IndicatorResult["series"]`
 * (`Record<string, …>`) sans repasser par un objet indexé anonyme.
 */
export type SeriesDivergence = {
  divHauss: Array<number | undefined>;
  divBaiss: Array<number | undefined>;
  divHaussCachee: Array<number | undefined>;
  divBaissCachee: Array<number | undefined>;
};

/**
 * `highs` / `lows` / `osc` sont alignés index-par-index sur les bougies (même
 * longueur). Le résultat expose les 4 séries alignées, prêtes à être rendues en
 * `style: "points"`. PURE.
 */
export function placerPointsDivergence(
  highs: ReadonlyArray<number>,
  lows: ReadonlyArray<number>,
  osc: ReadonlyArray<number | undefined>,
  opts: { gauche: number; droite: number; maxEcart: number },
): SeriesDivergence {
  const n = lows.length;
  const divHauss: Array<number | undefined> = new Array(n).fill(undefined);
  const divBaiss: Array<number | undefined> = new Array(n).fill(undefined);
  const divHaussCachee: Array<number | undefined> = new Array(n).fill(undefined);
  const divBaissCachee: Array<number | undefined> = new Array(n).fill(undefined);

  // Famille haussière : détectée sur les creux (lows), point posé au low du idxTo.
  for (const d of detecterDivergences(lows, osc, opts)) {
    const v = lows[d.idxTo];
    if (v === undefined) continue;
    if (d.type === "haussiere") divHauss[d.idxTo] = v;
    else if (d.type === "haussiere-cachee") divHaussCachee[d.idxTo] = v;
    // baissiere* sur les lows : ignoré (mauvaise série pour ce sens).
  }

  // Famille baissière : détectée sur les sommets (highs), point posé au high du idxTo.
  for (const d of detecterDivergences(highs, osc, opts)) {
    const v = highs[d.idxTo];
    if (v === undefined) continue;
    if (d.type === "baissiere") divBaiss[d.idxTo] = v;
    else if (d.type === "baissiere-cachee") divBaissCachee[d.idxTo] = v;
    // haussiere* sur les highs : ignoré (mauvaise série pour ce sens).
  }

  return { divHauss, divBaiss, divHaussCachee, divBaissCachee };
}
