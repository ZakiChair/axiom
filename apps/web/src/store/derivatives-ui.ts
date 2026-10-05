/**
 * Store UI des Produits dérivés — Zustand VANILLA (hors render-loop React).
 *
 * `open` MIROITE l'état de `windowManagerStore` (source de vérité géométrie/ouverture
 * de toutes les fenêtres flottantes) — cf. `mirrorOpenState`. Les données et clés
 * Coinalyze restent dans leurs stores/providers dédiés.
 */
import { createStore } from "zustand/vanilla";
import type { PlacePerp } from "../data/marchesPerp";
import { windowManagerStore, mirrorOpenState } from "./windowManager";

export interface DerivativesUiState {
  /** true quand le panneau Produits dérivés est ouvert. */
  open: boolean;
  /**
   * Place perp choisie par l'utilisateur, par actif (clé = base, ex. « PUMP »).
   * Session-only : jamais persistée (demande du 5 octobre 2026).
   */
  placesPerp: Readonly<Record<string, PlacePerp>>;
  /** Retient la place perp choisie pour un actif (sélecteur de la fenêtre DES). */
  choisirPlacePerp: (actif: string, place: PlacePerp) => void;
  /** Ouvre le panneau Produits dérivés. */
  openDerivatives: () => void;
  /** Ferme le panneau Produits dérivés. */
  closeDerivatives: () => void;
  /** Bascule l'ouverture du panneau (utilisé par le mnémonique DES). */
  toggleDerivatives: () => void;
}

export const derivativesUiStore = createStore<DerivativesUiState>((set) => ({
  open: false,
  placesPerp: {},
  choisirPlacePerp: (actif, place) =>
    set((s) => ({ placesPerp: { ...s.placesPerp, [actif]: place } })),
  openDerivatives: () => windowManagerStore.getState().openWindow("derivatives"),
  closeDerivatives: () => windowManagerStore.getState().closeWindow("derivatives"),
  toggleDerivatives: () => windowManagerStore.getState().toggleWindow("derivatives"),
}));

mirrorOpenState("derivatives", derivativesUiStore);
