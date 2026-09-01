/**
 * Store orderflow — Zustand VANILLA (hors render-loop React).
 *
 * Contient le drapeau d'activation de l'orderflow (CVD + footprint)
 * ET les paramètres avancés du rendu footprint (imbalances, POC, VA, divergences).
 * Lu en BASSE fréquence par la toolbar (bouton « Orderflow ») et par le contrôleur
 * orderflow du Chart (souscription impérative). Les données tick (trades, footprint)
 * ne transitent JAMAIS par ce store — elles vivent dans le contrôleur (cf. BUILD-CONTRACT).
 *
 * PERSISTANCE : le drapeau `enabled` est persisté par store/persist.ts (clé
 * `axiom:sessionUi:v1`) et restauré au boot — la persistance est DÉLÉGUÉE, ne pas
 * en recréer une ici (double maître). Le `ChartState` de @axiom/types reste figé.
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

  /** Seuil notionnel ($) des bulles baleines sur le chart (WHALE) — session-only. */
  whaleNotionalMin: number;
  setWhaleNotionalMin: (v: number) => void;

  /** Overlay OCN (Open/Close Net) — Binance perp only, façon Flux. */
  showOpenCloseNet: boolean;
  setShowOpenCloseNet: (v: boolean) => void;
  /** Fenêtre d'analyse OCN en bougies (défaut 32). */
  ocnLookback: number;
  setOcnLookback: (v: number) => void;
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

  whaleNotionalMin: 100_000,
  setWhaleNotionalMin: (v) => set({ whaleNotionalMin: v }),

  showOpenCloseNet: false,
  setShowOpenCloseNet: (v) => set({ showOpenCloseNet: v }),
  ocnLookback: 32,
  setOcnLookback: (v) => set({ ocnLookback: v }),
}));
