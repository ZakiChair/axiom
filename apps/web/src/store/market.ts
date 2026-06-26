/**
 * Store marché — Zustand VANILLA (hors render-loop React).
 *
 * Contient le symbole + le timeframe courants (lus par React, basse fréquence)
 * et un buffer de bougies (haute fréquence). Aucun composant ne sélectionne
 * `candles` : les ticks live ne déclenchent donc AUCUN re-render React — le
 * graphe est mis à jour de façon impérative depuis Chart.tsx.
 */
import { createStore } from "zustand/vanilla";
import type { Candle, ExchangeId, Timeframe } from "@axiom/types";

export interface MarketState {
  /** Source de marché courante (Binance par défaut). */
  exchange: ExchangeId;
  symbol: string;
  timeframe: Timeframe;
  /** Buffer de bougies (source de vérité), non abonné dans le rendu React. */
  candles: Candle[];
  setExchange: (exchange: ExchangeId) => void;
  setSymbol: (symbol: string) => void;
  setTimeframe: (timeframe: Timeframe) => void;
  /** Remplace le buffer (backfill REST). */
  setCandles: (candles: Candle[]) => void;
  /** Met à jour la dernière bougie (même open time) ou en ajoute une nouvelle. */
  upsertCandle: (candle: Candle) => void;
}

export const marketStore = createStore<MarketState>((set, get) => ({
  exchange: "binance",
  symbol: "BTCUSDT",
  timeframe: "1m",
  candles: [],

  setExchange: (exchange) => set({ exchange }),
  setSymbol: (symbol) => set({ symbol: symbol.toUpperCase() }),
  setTimeframe: (timeframe) => set({ timeframe }),
  setCandles: (candles) => set({ candles }),

  upsertCandle: (candle) => {
    const candles = get().candles;
    const last = candles[candles.length - 1];
    if (last && last.time === candle.time) {
      // Bougie en cours : on remplace la dernière.
      const next = candles.slice();
      next[next.length - 1] = candle;
      set({ candles: next });
    } else if (!last || candle.time > last.time) {
      // Nouvelle bougie : on l'ajoute en fin de buffer.
      set({ candles: [...candles, candle] });
    }
  },
}));
