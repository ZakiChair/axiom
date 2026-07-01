/**
 * Store UI des Produits dérivés — Zustand VANILLA (hors render-loop React).
 *
 * Tient UNIQUEMENT l'état d'ouverture de la fenêtre dédiée aux dérivés.
 * Volontairement éphémère : NON persisté (ne pas l'enregistrer dans persist.ts).
 * Les données et clés Coinalyze restent dans leurs stores/providers dédiés.
 */
import { createStore } from "zustand/vanilla";

export interface DerivativesUiState {
  /** true quand la fenêtre Produits dérivés est ouverte. */
  open: boolean;
  /** Ouvre la fenêtre Produits dérivés. */
  openDerivatives: () => void;
  /** Ferme la fenêtre Produits dérivés. */
  closeDerivatives: () => void;
}

export const derivativesUiStore = createStore<DerivativesUiState>((set) => ({
  open: false,
  openDerivatives: () => set({ open: true }),
  closeDerivatives: () => set({ open: false }),
}));
