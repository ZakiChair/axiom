/**
 * Store watchlist — Zustand VANILLA (hors render-loop React).
 *
 * Liste des symboles favoris, modifiée seulement à l'ajout/suppression (basse
 * fréquence). Les PRIX live ne transitent PAS par ce store : ils sont écrits
 * impérativement dans le DOM par le composant Watchlist (aucun re-render React
 * sur tick — cf. BUILD-CONTRACT).
 *
 * SOURCE D'ORIGINE (roadmap 0.4b) : chaque entrée peut porter la source dont elle
 * provient (`sources[symbole]`), pour que data/ticker route le flux de prix vers le
 * bon exchange. La map est CREUSE : seules les entrées à source EXPLICITE y figurent
 * (posées via `add(symbole, source)`) ; les entrées sans source y sont absentes et
 * sont routées par inférence côté ticker (tradfi -> Twelve Data, sinon Binance par
 * défaut). Ce défaut « Binance » couvre les entrées historiques / persistées en clair.
 */
import { createStore } from "zustand/vanilla";

/** Sources câblées pouvant alimenter un ticker de watchlist (cf. data/adapters.ts). */
export type WatchlistSource = "binance" | "kraken" | "coinbase" | "mexc" | "twelvedata";

/** Favoris par défaut (écrasés par la valeur persistée si présente). */
export const DEFAULT_WATCHLIST = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

export interface WatchlistState {
  symbols: string[];
  /** Sources EXPLICITES par symbole (map creuse ; absence => inférence côté ticker). */
  sources: Record<string, WatchlistSource>;
  /** Ajoute un symbole ; `source` optionnelle fige sa provenance (sinon inférée au routage). */
  add: (symbol: string, source?: WatchlistSource) => void;
  remove: (symbol: string) => void;
  /** Remplace toute la liste (restauration depuis localStorage) ; `sources` optionnelle. */
  setAll: (symbols: string[], sources?: Record<string, WatchlistSource>) => void;
}

export const watchlistStore = createStore<WatchlistState>((set, get) => ({
  symbols: [...DEFAULT_WATCHLIST],
  sources: {},

  add: (symbol, source) => {
    const s = symbol.trim().toUpperCase();
    if (s.length === 0) return;
    const current = get().symbols;
    if (current.includes(s)) return;
    const sources = source ? { ...get().sources, [s]: source } : get().sources;
    set({ symbols: [...current, s], sources });
  },

  remove: (symbol) => {
    const sources = { ...get().sources };
    delete sources[symbol];
    set({ symbols: get().symbols.filter((s) => s !== symbol), sources });
  },

  setAll: (symbols, sources) => set({ symbols, sources: sources ?? {} }),
}));
