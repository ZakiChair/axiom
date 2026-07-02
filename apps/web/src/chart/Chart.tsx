/**
 * Chart — slot MAÎTRE de la grille multi-chart (Phase 4).
 *
 * L'implémentation d'une instance vit désormais dans `ChartInstance` (réutilisable par
 * slot). Ce module reste le point d'entrée « mono-chart » historique : il monte
 * l'instance MAÎTRE branchée sur le `marketStore` GLOBAL (piloté par la toolbar, la
 * palette, la watchlist…), avec le jeu COMPLET de contrôleurs.
 *
 * ChartGrid (grille 1/2h/2v/2×2) réutilise `<Chart/>` pour le slot 0 et `<ChartInstance/>`
 * pour les slots secondaires. On RE-EXPORTE ici `priceScaleStore` / `PriceScaleType` :
 * `store/persist.ts` les importe depuis `../chart/Chart` (chemin conservé, changement
 * chirurgical).
 */
import { marketStore } from "../store/market";
import { ChartInstance } from "./ChartInstance";

export { priceScaleStore } from "./ChartInstance";
export type { PriceScaleType } from "./ChartInstance";

export function Chart() {
  return <ChartInstance store={marketStore} slot={0} role="master" />;
}
