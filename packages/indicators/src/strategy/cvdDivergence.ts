/**
 * @axiom/indicators — strategy/cvdDivergence.ts
 *
 * Divergences CVD ↔ prix, v2 (lot v2.1) : pane SÉPARÉ portant la courbe CVD,
 * segments pivot→pivot sur le CVD (cible "pane") ET sur le prix (cible "prix",
 * rendus en overlays par l'app), labels « Div ▲/▼ » (régulières), pointillés
 * pour les cachées, tooltips. Détection inchangée (detecterDivergences via le
 * moteur commun) ; l'oscillateur reste le CVD cumulé (`cvdOf`) — la lecture
 * d'orderflow la plus utile en divergence : le prix pousse un nouvel extrême
 * que le flux agresseur ne suit pas. Remplace le rendu « 4 sorties points » de
 * la v1 (limite consignée : pas de rayon, cachées indistinguables — levée par
 * le canal d'annotations).
 *
 * Dégradation propre : une source SANS champs taker buy/sell (ex. actions
 * TwelveData) donne un CVD plat à 0 → aucun pivot fractal strict → aucune
 * divergence → aucune annotation, sans erreur.
 */

import { defDivergenceOscillateur } from "../utils-fabrique-divergence";
import { cvdOf } from "../orderflow/cvd";

export const cvdDivergence = defDivergenceOscillateur({
  id: "cvdDivergence",
  name: "Divergence CVD",
  category: "strategy",
  precision: 0,
  serieOsc: { key: "cvd", name: "CVD" },
  inputsOsc: [],
  formateur: (v) => v.toFixed(0), // volumes cumulés : pas de décimales dans les tooltips
  oscillateur: (candles) => cvdOf(candles),
});
