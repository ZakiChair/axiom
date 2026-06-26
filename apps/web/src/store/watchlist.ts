/**
 * Store watchlist — Zustand VANILLA (hors render-loop React).
 *
 * Liste des symboles favoris, modifiée seulement à l'ajout/suppression (basse
 * fréquence). Les PRIX live ne transitent PAS par ce store : ils sont écrits
 * impérativement dans le DOM par le composant Watchlist (aucun re-render React
 * sur tick — cf. BUILD-CONTRACT).
 */
import { createStore } from "zustand/vanilla";

/** Favoris par défaut (écrasés par la valeur persistée si présente). */
export const DEFAULT_WATCHLIST = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

export interface WatchlistState {
  symbols: string[];
  add: (symbol: string) => void;
  remove: (symbol: string) => void;
  /** Remplace toute la liste (restauration depuis localStorage). */
  setAll: (symbols: string[]) => void;
}

export const watchlistStore = createStore<WatchlistState>((set, get) => ({
  symbols: [...DEFAULT_WATCHLIST],

  add: (symbol) => {
    const s = symbol.trim().toUpperCase();
    if (s.length === 0) return;
    const current = get().symbols;
    if (current.includes(s)) return;
    set({ symbols: [...current, s] });
  },

  remove: (symbol) => {
    set({ symbols: get().symbols.filter((s) => s !== symbol) });
  },

  setAll: (symbols) => set({ symbols }),
}));
