/**
 * Store orderflow — Zustand VANILLA (hors render-loop React).
 *
 * Contient le drapeau d'activation de l'orderflow (CVD + footprint)
 * ET les paramètres avancés du rendu footprint (imbalances, POC, VA, divergences).
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

  /* ── Paramètres avancés footprint ── */
  showImbalances: boolean;
  setShowImbalances: (v: boolean) => void;
  imbalanceRatioPct: number; // seuil % (défaut 300)
  setImbalanceRatioPct: (v: number) => void;
  imbalanceMinVol: number;
  setImbalanceMinVol: (v: number) => void;

  showBarPoc: boolean;
  setShowBarPoc: (v: boolean) => void;
  showBarVa: boolean;
  setShowBarVa: (v: boolean) => void;
  showDivergences: boolean;
  setShowDivergences: (v: boolean) => void;

  /** Sous-pane « CVD S/P » (spot vs perp) — Binance only, slot focus (Task 17). */
  cvdSpotPerp: boolean;
  setCvdSpotPerp: (v: boolean) => void;
}

export const orderflowStore = createStore<OrderflowState>((set, get) => ({
  enabled: false,
  toggle: () => set({ enabled: !get().enabled }),
  setEnabled: (enabled) => set({ enabled }),

  /* ── Paramètres avancés footprint ── */
  showImbalances: true,
  setShowImbalances: (v) => set({ showImbalances: v }),
  imbalanceRatioPct: 300,
  setImbalanceRatioPct: (v) => set({ imbalanceRatioPct: v }),
  imbalanceMinVol: 0,
  setImbalanceMinVol: (v) => set({ imbalanceMinVol: v }),

  showBarPoc: true,
  setShowBarPoc: (v) => set({ showBarPoc: v }),
  showBarVa: false,
  setShowBarVa: (v) => set({ showBarVa: v }),
  showDivergences: true,
  setShowDivergences: (v) => set({ showDivergences: v }),

  cvdSpotPerp: false,
  setCvdSpotPerp: (v) => set({ cvdSpotPerp: v }),
}));
