/**
 * Store UI des Produits dérivés — Zustand VANILLA (hors render-loop React).
 *
 * Tient UNIQUEMENT l'état d'ouverture du PANNEAU (dockable, non modal) des dérivés.
 * Volontairement éphémère : NON persisté (ne pas l'enregistrer dans persist.ts).
 * Les données et clés Coinalyze restent dans leurs stores/providers dédiés.
 */
import { createStore } from "zustand/vanilla";

export interface DerivativesUiState {
  /** true quand le panneau Produits dérivés est ouvert. */
  open: boolean;
  /** Ouvre le panneau Produits dérivés. */
  openDerivatives: () => void;
  /** Ferme le panneau Produits dérivés. */
  closeDerivatives: () => void;
  /** Bascule l'ouverture du panneau (utilisé par le mnémonique DES). */
  toggleDerivatives: () => void;
}

export const derivativesUiStore = createStore<DerivativesUiState>((set, get) => ({
  open: false,
  openDerivatives: () => set({ open: true }),
  closeDerivatives: () => set({ open: false }),
  toggleDerivatives: () => set({ open: !get().open }),
}));
