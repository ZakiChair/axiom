/**
 * Store UI de la Vue marché (IMAP) — Zustand VANILLA (hors render-loop React).
 *
 * Tient UNIQUEMENT l'état d'ouverture du PANNEAU (dockable, non modal) de la treemap.
 * Volontairement éphémère : NON persisté (ne pas l'enregistrer dans persist.ts).
 * Les données CoinGecko vivent dans leur module dédié (data/marketOverview.ts).
 * Même pattern que store/derivatives-ui.ts.
 */
import { createStore } from "zustand/vanilla";

export interface MarketMapUiState {
  /** true quand le panneau Vue marché est ouvert. */
  open: boolean;
  /** Ouvre le panneau. */
  openMarketMap: () => void;
  /** Ferme le panneau. */
  closeMarketMap: () => void;
  /** Bascule l'ouverture (utilisé par le mnémonique IMAP). */
  toggleMarketMap: () => void;
}

export const marketMapUiStore = createStore<MarketMapUiState>((set, get) => ({
  open: false,
  openMarketMap: () => set({ open: true }),
  closeMarketMap: () => set({ open: false }),
  toggleMarketMap: () => set({ open: !get().open }),
}));
