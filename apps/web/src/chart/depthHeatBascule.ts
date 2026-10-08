/**
 * Bascule de la heatmap de liquidité du carnet (BOOK) — seule partie de `depthHeat` qui
 * reste sur le chemin de chargement initial. La commande de la palette et ChartInstance
 * lisent `actif` ici ; le module `depthHeat.ts` (échantillonnage du carnet, contrôleur
 * canvas, `data/depth`, `rampesHeat`) n'est chargé par `import()` qu'à la première
 * activation (budget d'entrée, garde-fou : chargementInitial.test.ts).
 *
 * Aucune donnée tick ici (invariant `store/orderflow.ts:6-8`) : seuls `actif` et `rev`
 * (compteur de révision, bumpé au plus 1×/s par l'échantillonnage ou lors d'un
 * (ré)abonnement/reset). Le buffer de colonnes vit en variable module dans `depthHeat.ts`.
 */
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";

export interface DepthHeatState {
  actif: boolean;
  rev: number;
  basculer: () => void;
}

export const depthHeatStore: StoreApi<DepthHeatState> = createStore<DepthHeatState>((set, get) => ({
  actif: false,
  rev: 0,
  basculer: () => set({ actif: !get().actif }),
}));
