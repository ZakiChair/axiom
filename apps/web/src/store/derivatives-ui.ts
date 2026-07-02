/**
 * Store UI des Produits dérivés — Zustand VANILLA (hors render-loop React).
 *
 * `open` MIROITE l'état de `windowManagerStore` (source de vérité géométrie/ouverture
 * de toutes les fenêtres flottantes) — cf. `mirrorOpenState`. Les données et clés
 * Coinalyze restent dans leurs stores/providers dédiés.
 */
import { createStore } from "zustand/vanilla";
import { windowManagerStore, mirrorOpenState } from "./windowManager";

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

export const derivativesUiStore = createStore<DerivativesUiState>(() => ({
  open: false,
  openDerivatives: () => windowManagerStore.getState().openWindow("derivatives"),
  closeDerivatives: () => windowManagerStore.getState().closeWindow("derivatives"),
  toggleDerivatives: () => windowManagerStore.getState().toggleWindow("derivatives"),
}));

mirrorOpenState("derivatives", derivativesUiStore);
