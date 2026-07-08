/**
 * `anneesDeMaturite` — conversion PURE d'un libellé de maturité de la courbe des taux
 * (« 1 Mo », « 1.5 Month », « 10 Yr »…) en nombre d'années (fraction pour les mois).
 * Extraite de `CourbeTaux.tsx` pour rester testable indépendamment du composant canvas
 * (lui-même non unit-testé, cf. convention `Sparkline`/`SeasonalityWindow`).
 *
 * Les libellés reconnus sont ceux produits par le CSV du Trésor US (« N Mo », le cas
 * irrégulier « 1.5 Month », « N Yr ») — cf. `treasuryYields.ts`. Toute forme inconnue
 * (y compris les libellés « N Yr » de la zone euro, déjà directement en années et donc
 * pas soumis à cette fonction côté appelant) renvoie `NaN`.
 */
export function anneesDeMaturite(m: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(Mo|Month|Yr)$/i.exec(m.trim());
  if (!match) return NaN;
  const valeur = Number(match[1]);
  const unite = match[2]!.toLowerCase();
  return unite === "yr" ? valeur : valeur / 12;
}
