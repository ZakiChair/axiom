/**
 * Store des indicateurs actifs — Zustand VANILLA (hors render-loop React).
 *
 * Contient la liste des `IndicatorInstance` (defId + params) actuellement
 * affichés sur le graphe. Lu en BASSE fréquence par le panneau « Indicateurs »
 * et par le contrôleur d'indicateurs du Chart (souscription impérative).
 *
 * IMPORTANT : ce store ne stocke QUE la SÉLECTION. La source de vérité du
 * CALCUL reste @axiom/indicators (cf. BUILD-CONTRACT).
 */
import { createStore } from "zustand/vanilla";
import type { IndicatorInstance } from "@axiom/types";
import { getIndicator } from "@axiom/indicators";

/** Paramètres par défaut déclarés dans les `inputs` d'une définition. */
export function defaultParams(defId: string): Record<string, number | boolean | string> {
  const def = getIndicator(defId);
  const params: Record<string, number | boolean | string> = {};
  if (!def) return params;
  for (const input of def.inputs) params[input.key] = input.default;
  return params;
}

export interface IndicatorsState {
  indicators: IndicatorInstance[];
  /** Active/désactive un indicateur par son defId. */
  toggle: (defId: string) => void;
  /** Remplace toute la liste (restauration depuis localStorage). */
  setAll: (indicators: IndicatorInstance[]) => void;
}

export const indicatorsStore = createStore<IndicatorsState>((set, get) => ({
  indicators: [],

  toggle: (defId) => {
    const current = get().indicators;
    const exists = current.some((i) => i.defId === defId);
    if (exists) {
      set({ indicators: current.filter((i) => i.defId !== defId) });
    } else {
      // À l'activation, on fige les paramètres par défaut (état persistable explicite).
      set({ indicators: [...current, { defId, params: defaultParams(defId) }] });
    }
  },

  setAll: (indicators) => set({ indicators }),
}));
