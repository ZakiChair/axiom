/**
 * Store Volume Profile — Zustand VANILLA (hors render-loop React).
 *
 * Tient le drapeau d'activation du profil de volume par prix (VPVR : volume
 * réparti par niveau de prix sur la plage visible). Lu en BASSE fréquence par la
 * toolbar (bouton « Profil Vol ») et par le contrôleur Chart (rendu impératif sur
 * canvas). Aucune donnée de calcul ne transite par ce store (cf. BUILD-CONTRACT).
 *
 * PERSISTANCE : `enabled` est persisté par store/persist.ts (clé `axiom:sessionUi:v1`,
 * persistance déléguée — ne pas en recréer ici). ChartState @axiom/types reste figé.
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
