/**
 * Store Volume Profile — Zustand VANILLA (hors render-loop React).
 *
 * Tient le drapeau d'activation du profil de volume par prix (VPVR : volume
 * réparti par niveau de prix sur la plage visible). Lu en BASSE fréquence par la
 * toolbar (bouton « Profil Vol ») et par le contrôleur Chart (rendu impératif sur
 * canvas). Aucune donnée de calcul ne transite par ce store (cf. BUILD-CONTRACT).
 *
 * Session-only : non persisté (ChartState @axiom/types est figé).
 */
import { createStore } from "zustand/vanilla";

export interface VolumeProfileState {
  enabled: boolean;
  toggle: () => void;
  setEnabled: (enabled: boolean) => void;
}

export const volumeProfileStore = createStore<VolumeProfileState>((set, get) => ({
  enabled: false,
  toggle: () => set({ enabled: !get().enabled }),
  setEnabled: (enabled) => set({ enabled }),
}));
