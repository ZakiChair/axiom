/**
 * Store revenus protocole — Zustand VANILLA (hors render-loop React).
 *
 * Ne contient QUE le drapeau d'activation de la courbe « Revenus du protocole »
 * (sous-pane dédié). Lu en BASSE fréquence par la toolbar (bouton « Revenus ») et
 * par le contrôleur revenus du Chart (souscription impérative). Les séries de
 * revenus (DefiLlama) ne transitent PAS par ce store — elles vivent dans le
 * contrôleur (cf. BUILD-CONTRACT, comme orderflow/compare).
 *
 * Session-only : non persisté (le `ChartState` de @axiom/types est figé).
 */
import { createStore } from "zustand/vanilla";

export interface RevenueState {
  enabled: boolean;
  toggle: () => void;
  setEnabled: (enabled: boolean) => void;
}

export const revenueStore = createStore<RevenueState>((set, get) => ({
  enabled: false,
  toggle: () => set({ enabled: !get().enabled }),
  setEnabled: (enabled) => set({ enabled }),
}));
