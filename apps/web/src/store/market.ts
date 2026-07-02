/**
 * Store marché — Zustand VANILLA (hors render-loop React).
 *
 * Contient le symbole + le timeframe courants (lus par React, basse fréquence)
 * et un buffer de bougies (haute fréquence). Aucun composant ne sélectionne
 * `candles` : les ticks live ne déclenchent donc AUCUN re-render React — le
 * graphe est mis à jour de façon impérative depuis Chart.tsx.
 */
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import type { Candle, ExchangeId, Timeframe } from "@axiom/types";

/**
 * Fenêtre glissante max du buffer : sans borne, une session longue (terminal mono-
 * utilisateur censé rester ouvert en continu) fait grossir `candles` indéfiniment,
 * alors que upsertCandle copie tout le tableau à chaque tick (même non clôturé).
 */
const MAX_CANDLES = 5000;

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

/** Type du store marché (une instance par slot de la grille multi-chart). */
export type MarketStore = StoreApi<MarketState>;

/** Configuration initiale optionnelle d'une instance (slot secondaire de la grille). */
export interface MarketStoreInit {
  exchange?: ExchangeId;
  symbol?: string;
  timeframe?: Timeframe;
}

/**
 * Fabrique un store marché INDÉPENDANT (buffer + symbole/TF/source propres).
 *
 * Multi-chart (Phase 4) : chaque slot de la grille possède SA propre instance —
 * son buffer de bougies, son symbole, son timeframe et sa source sont isolés des
 * autres slots. Le slot MAÎTRE (slot 0) réutilise l'instance globale `marketStore`
 * exportée ci-dessous (rétro-compatibilité : toolbar, palette, alertes, persistance…
 * la pilotent inchangée) ; les slots secondaires créent la leur via cette fabrique.
 */
export function createMarketStore(init: MarketStoreInit = {}): MarketStore {
  return createStore<MarketState>((set, get) => ({
    exchange: init.exchange ?? "binance",
    symbol: (init.symbol ?? "BTCUSDT").toUpperCase(),
    timeframe: init.timeframe ?? "1m",
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
        // Nouvelle bougie : on l'ajoute en fin de buffer, borné à MAX_CANDLES.
        const next = [...candles, candle];
        set({ candles: next.length > MAX_CANDLES ? next.slice(next.length - MAX_CANDLES) : next });
      }
    },
  }));
}

/**
 * Instance GLOBALE = slot MAÎTRE (slot 0) de la grille multi-chart. Reste l'unique
 * store lu/écrit par toute l'app existante (toolbar, palette, watchlist, alertes,
 * persistance, dérivés, orderflow…) : la Phase 4 n'y touche pas — elle ajoute
 * seulement des instances secondaires via `createMarketStore`.
 */
export const marketStore: MarketStore = createMarketStore();
