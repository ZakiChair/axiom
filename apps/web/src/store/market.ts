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
import { estSymboleCapitalisation } from "../data/mcap";
import { parseSyntheticSymbol } from "../data/synthetic";


export interface MarketState {
  /** Source de marché courante (Binance par défaut). */
  exchange: ExchangeId;
  symbol: string;
  timeframe: Timeframe;
  /** Buffer de bougies (source de vérité), non abonné dans le rendu React. */
  candles: Candle[];
  /** Cycle du backfill courant, séparant explicitement la demande du dernier jeu chargé. */
  dataLoad: MarketDataLoadState;
  /** Bascule atomiquement source/symbole/timeframe et invalide une seule fois les données. */
  setMarket: (identity: MarketIdentity) => void;
  setExchange: (exchange: ExchangeId) => void;
  setSymbol: (symbol: string) => void;
  setTimeframe: (timeframe: Timeframe) => void;
  /** Démarre un backfill et invalide immédiatement le buffer précédent. */
  startDataLoad: (identity: MarketIdentity) => number | null;
  /** Commit atomique du backfill, ignoré si l'identité a changé entre-temps. */
  completeDataLoad: (identity: MarketIdentity, requestId: number, candles: Candle[]) => boolean;
  /** Échec du backfill courant, ignoré si la requête est devenue obsolète. */
  failDataLoad: (identity: MarketIdentity, requestId: number, error: string) => boolean;
  /** Remplace le buffer (backfill REST). */
  setCandles: (candles: Candle[]) => void;
  /** Met à jour la dernière bougie (même open time) ou en ajoute une nouvelle. */
  upsertCandle: (candle: Candle) => void;
  /** Variante liée à une identité : refuse les ticks d'un ancien abonnement. */
  upsertCandleFor: (identity: MarketIdentity, requestId: number, candle: Candle) => boolean;
}

/** Identité immuable d'un jeu de bougies. */
export interface MarketIdentity {
  exchange: ExchangeId;
  symbol: string;
  timeframe: Timeframe;
}

export type MarketDataLoadState =
  | {
      status: "idle" | "loading";
      requestId: number;
      requested: MarketIdentity;
      loaded: MarketIdentity | null;
      error: null;
    }
  | {
      status: "ready";
      requestId: number;
      requested: MarketIdentity;
      loaded: MarketIdentity;
      error: null;
    }
  | {
      status: "error";
      requestId: number;
      requested: MarketIdentity;
      loaded: MarketIdentity | null;
      error: string;
    };

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
export function normalizeMarketSymbol(symbol: string): string {
  const trimmed = symbol.trim();
  // Les séries synthétiques encodent aussi les ids de source (`binance:...`) :
  // uppercaser toute la chaîne rendrait le symbole impossible à parser.
  return trimmed.includes("|") ? trimmed : trimmed.toUpperCase();
}

/** Identité courante d'un store (copie volontaire : sûre à capturer dans une closure async). */
export function marketIdentity(
  state: Pick<MarketState, "exchange" | "symbol" | "timeframe">,
): MarketIdentity {
  return { exchange: state.exchange, symbol: state.symbol, timeframe: state.timeframe };
}

export function sameMarketIdentity(a: MarketIdentity | null, b: MarketIdentity | null): boolean {
  return (
    a !== null &&
    b !== null &&
    a.exchange === b.exchange &&
    a.symbol === b.symbol &&
    a.timeframe === b.timeframe
  );
}

/** Vrai uniquement quand le buffer visible appartient effectivement à `identity`. */
export function isMarketDataReady(
  state: MarketState,
  identity: MarketIdentity,
  requestId: number,
): boolean {
  return (
    state.dataLoad.status === "ready" &&
    state.dataLoad.requestId === requestId &&
    sameMarketIdentity(marketIdentity(state), identity) &&
    sameMarketIdentity(state.dataLoad.requested, identity) &&
    sameMarketIdentity(state.dataLoad.loaded, identity)
  );
}

function loadingState(previous: MarketDataLoadState, requested: MarketIdentity): MarketDataLoadState {
  return {
    status: "loading",
    requestId: previous.requestId + 1,
    requested,
    loaded: previous.loaded,
    error: null,
  };
}

/**
 * Source cohérente avec le symbole demandé, lors d'un changement de SYMBOLE SEUL.
 *
 * `synthetic` n'est pas une vraie source : son adaptateur ne lit que les symboles SYN
 * encodés ou les TOTAL* autonomes. Les appelants qui ne posent QUE le symbole (recherche
 * de paires, watchlist, navigation, playbooks) laisseraient sinon la source virtuelle en
 * place face à un ticker normal — backfill impossible. Quitter un ratio = revenir à la
 * source de sa jambe A ; une jambe `mcap` revient à `synthetic`, et un ticker normal à
 * Binance si l'ancien symbole n'indique aucune source réelle exploitable.
 *
 * Volontairement absent de `setMarket`/`setExchange` : une source posée EXPLICITEMENT
 * doit gagner, sinon la séquence `setExchange("synthetic")` puis `setSymbol(SYN)` (SYN
 * builder, restauration de session) ne pourrait plus jamais entrer dans un ratio.
 */
function exchangeForSymbol(
  state: Pick<MarketState, "exchange" | "symbol">,
  nextSymbol: string,
): ExchangeId {
  if (estSymboleCapitalisation(nextSymbol) || parseSyntheticSymbol(nextSymbol) !== null) {
    return "synthetic";
  }
  if (state.exchange !== "synthetic") return state.exchange;
  const sourcePrecedente = parseSyntheticSymbol(state.symbol)?.exA;
  return sourcePrecedente === undefined || sourcePrecedente === "mcap"
    ? "binance"
    : sourcePrecedente;
}

/**
 * Calcule le buffer suivant ; `null` signifie tick hors-ordre à ignorer.
 *
 * AUCUNE troncature ici : le buffer doit rester le miroir EXACT de la dataList de
 * KLineChart (indicateurs, CVD et footprint sont mappés index-par-index dessus, cf.
 * chart/indicators.ts). L'ancienne fenêtre glissante de 5 000 désalignait les deux dès
 * la première bougie live après une pagination profonde (dataList à 20 000). La borne
 * mémoire réelle : purge à chaque changement d'identité (setMarket/startDataLoad) +
 * plafond de pagination (ChartInstance) + croissance live d'1 bougie/période.
 */
function withCandle(candles: Candle[], candle: Candle): Candle[] | null {
  const last = candles[candles.length - 1];
  if (last && last.time === candle.time) {
    const next = candles.slice();
    next[next.length - 1] = candle;
    return next;
  }
  if (!last || candle.time > last.time) {
    return [...candles, candle];
  }
  return null;
}

export function createMarketStore(init: MarketStoreInit = {}): MarketStore {
  const exchange = init.exchange ?? "binance";
  const symbol = normalizeMarketSymbol(init.symbol ?? "BTCUSDT");
  const timeframe = init.timeframe ?? "1m";
  const initialIdentity: MarketIdentity = { exchange, symbol, timeframe };

  return createStore<MarketState>((set, get) => ({
    exchange,
    symbol,
    timeframe,
    candles: [],
    dataLoad: { status: "idle", requestId: 0, requested: initialIdentity, loaded: null, error: null },

    // L'invalidation vit dans les setters : l'en-tête React ne peut jamais basculer vers
    // une nouvelle identité tout en laissant l'ancien buffer présenté comme s'il lui
    // appartenait. `loaded` est conservée uniquement comme provenance du dernier succès.
    setMarket: (nextIdentity) => {
      const state = get();
      const requested: MarketIdentity = {
        exchange: nextIdentity.exchange,
        symbol: normalizeMarketSymbol(nextIdentity.symbol),
        timeframe: nextIdentity.timeframe,
      };
      if (sameMarketIdentity(marketIdentity(state), requested)) return;
      set({
        exchange: requested.exchange,
        symbol: requested.symbol,
        timeframe: requested.timeframe,
        candles: [],
        dataLoad: loadingState(state.dataLoad, requested),
      });
    },
    setExchange: (nextExchange) => {
      const state = get();
      state.setMarket({ ...marketIdentity(state), exchange: nextExchange });
    },
    setSymbol: (nextSymbol) => {
      const state = get();
      const symbol = normalizeMarketSymbol(nextSymbol);
      const spec = parseSyntheticSymbol(symbol);
      const capitalisation =
        estSymboleCapitalisation(symbol) || spec?.exA === "mcap" || spec?.exB === "mcap";
      state.setMarket({
        ...marketIdentity(state),
        symbol,
        exchange: exchangeForSymbol(state, symbol),
        timeframe: capitalisation ? "1d" : state.timeframe,
      });
    },
    setTimeframe: (nextTimeframe) => {
      const state = get();
      state.setMarket({ ...marketIdentity(state), timeframe: nextTimeframe });
    },

    startDataLoad: (identity) => {
      const state = get();
      if (!sameMarketIdentity(marketIdentity(state), identity)) return null;
      const dataLoad = loadingState(state.dataLoad, identity);
      set({ candles: [], dataLoad });
      return dataLoad.requestId;
    },

    completeDataLoad: (identity, requestId, nextCandles) => {
      const state = get();
      if (
        state.dataLoad.requestId !== requestId ||
        !sameMarketIdentity(marketIdentity(state), identity) ||
        !sameMarketIdentity(state.dataLoad.requested, identity)
      ) return false;
      set({
        candles: nextCandles,
        dataLoad: { status: "ready", requestId, requested: identity, loaded: identity, error: null },
      });
      return true;
    },

    failDataLoad: (identity, requestId, error) => {
      const state = get();
      if (
        state.dataLoad.requestId !== requestId ||
        !sameMarketIdentity(marketIdentity(state), identity) ||
        !sameMarketIdentity(state.dataLoad.requested, identity)
      ) return false;
      set({
        candles: [],
        dataLoad: {
          status: "error",
          requestId,
          requested: identity,
          loaded: state.dataLoad.loaded,
          error,
        },
      });
      return true;
    },

    setCandles: (candles) => set({ candles }),

    upsertCandle: (candle) => {
      const next = withCandle(get().candles, candle);
      if (next) set({ candles: next });
    },

    upsertCandleFor: (identity, requestId, candle) => {
      const state = get();
      if (!isMarketDataReady(state, identity, requestId)) return false;
      const next = withCandle(state.candles, candle);
      if (!next) return false;
      set({ candles: next });
      return true;
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
