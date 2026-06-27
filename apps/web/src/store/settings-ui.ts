/**
 * Store UI des Réglages — Zustand VANILLA (hors render-loop React).
 *
 * Tient UNIQUEMENT l'état d'ouverture du panneau Réglages (slide-over droit).
 * Volontairement éphémère : NON persisté (ne pas l'enregistrer dans persist.ts).
 * Aucune clé API ni donnée sensible ici — la gestion des clés reste dans les
 * stores dédiés (coinalyze, macro/fred).
 */
import { createStore } from "zustand/vanilla";

export interface SettingsUiState {
  /** true quand le panneau Réglages est ouvert. */
  open: boolean;
  /** Ouvre le panneau Réglages. */
  openSettings: () => void;
  /** Ferme le panneau Réglages. */
  closeSettings: () => void;
}

export const settingsUiStore = createStore<SettingsUiState>((set) => ({
  open: false,
  openSettings: () => set({ open: true }),
  closeSettings: () => set({ open: false }),
}));
