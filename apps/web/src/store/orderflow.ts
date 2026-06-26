/**
 * Store orderflow — Zustand VANILLA (hors render-loop React).
 *
 * Contient UNIQUEMENT le drapeau d'activation de l'orderflow (CVD + footprint).
 * Lu en BASSE fréquence par la toolbar (bouton « Orderflow ») et par le contrôleur
 * orderflow du Chart (souscription impérative). Les données tick (trades, footprint)
 * ne transitent JAMAIS par ce store — elles vivent dans le contrôleur (cf. BUILD-CONTRACT).
 *
 * Session-only : non persisté (le `ChartState` de @axiom/types est figé et ne
 * comporte pas de champ orderflow ; on ne modifie pas les types).
 */
import { createStore } from "zustand/vanilla";

export interface OrderflowState {
  enabled: boolean;
  toggle: () => void;
  setEnabled: (enabled: boolean) => void;
}

export const orderflowStore = createStore<OrderflowState>((set, get) => ({
  enabled: false,
  toggle: () => set({ enabled: !get().enabled }),
  setEnabled: (enabled) => set({ enabled }),
}));
