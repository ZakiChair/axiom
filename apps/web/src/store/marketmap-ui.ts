/**
 * Store UI de la Vue marché (IMAP) — Zustand VANILLA (hors render-loop React).
 *
 * `open` MIROITE l'état de `windowManagerStore` — cf. `mirrorOpenState`. Les données
 * CoinGecko vivent dans leur module dédié (data/marketOverview.ts).
 */
import { createStore } from "zustand/vanilla";
import { windowManagerStore, mirrorOpenState } from "./windowManager";

/** Onglets de la vue marché ; « classement » est aussi ouvert par le mnémonique TOP. */
export type OngletMarketMap = "carte" | "secteurs" | "classement";

export interface MarketMapUiState {
  /** true quand le panneau Vue marché est ouvert. */
  open: boolean;
  /** Ouvre le panneau. */
  openMarketMap: () => void;
  /** Ferme le panneau. */
  closeMarketMap: () => void;
  /** Bascule l'ouverture (utilisé par le mnémonique IMAP). */
  toggleMarketMap: () => void;
  /** Onglet affiché. */
  onglet: OngletMarketMap;
  setOnglet: (onglet: OngletMarketMap) => void;
  /** Ouvre la vue marché sur le classement des performances (mnémonique TOP). */
  ouvrirClassement: () => void;
}

export const marketMapUiStore = createStore<MarketMapUiState>((set) => ({
  open: false,
  onglet: "carte",
  setOnglet: (onglet) => set({ onglet }),
  ouvrirClassement: () => {
    set({ onglet: "classement" });
    windowManagerStore.getState().openWindow("marketMap");
  },
  openMarketMap: () => windowManagerStore.getState().openWindow("marketMap"),
  closeMarketMap: () => windowManagerStore.getState().closeWindow("marketMap"),
  toggleMarketMap: () => windowManagerStore.getState().toggleWindow("marketMap"),
}));

mirrorOpenState("marketMap", marketMapUiStore);
