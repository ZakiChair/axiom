/**
 * Store UI de la Vue marché (IMAP) — Zustand VANILLA (hors render-loop React).
 *
 * `open` MIROITE l'état de `windowManagerStore` — cf. `mirrorOpenState`. Les données
 * CoinGecko vivent dans leur module dédié (data/marketOverview.ts).
 */
import { createStore } from "zustand/vanilla";
import { windowManagerStore, mirrorOpenState } from "./windowManager";

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

export const marketMapUiStore = createStore<MarketMapUiState>(() => ({
  open: false,
  openMarketMap: () => windowManagerStore.getState().openWindow("marketMap"),
  closeMarketMap: () => windowManagerStore.getState().closeWindow("marketMap"),
  toggleMarketMap: () => windowManagerStore.getState().toggleWindow("marketMap"),
}));

mirrorOpenState("marketMap", marketMapUiStore);
