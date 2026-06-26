/**
 * Persistance locale (localStorage) — restaure et sauvegarde :
 *  - le `ChartState` (symbole, timeframe, indicateurs actifs + params) ;
 *  - la watchlist (symboles favoris).
 *
 * Wiring (cf. main.tsx) : `hydrateStores()` AVANT le rendu (les stores prennent
 * la valeur persistée), puis `enablePersistence()` qui sauvegarde sur changement.
 *
 * Garde anti-écriture-en-boucle : on N'ÉCRIT PAS sur tick. La souscription au
 * marketStore ne déclenche une sauvegarde que si symbole/timeframe changent — le
 * buffer de bougies change à chaque tick mais il est explicitement ignoré.
 */
import type { ChartState, IndicatorInstance, Timeframe } from "@axiom/types";
import { getIndicator } from "@axiom/indicators";
import { marketStore } from "./market";
import { indicatorsStore, defaultParams } from "./indicators";
import { watchlistStore, DEFAULT_WATCHLIST } from "./watchlist";

const CHART_KEY = "axiom:chartState:v1";
const WATCH_KEY = "axiom:watchlist:v1";

/** Lecture JSON tolérante (localStorage indisponible / JSON corrompu => null). */
function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Écriture JSON tolérante (quota / mode privé => silencieux). */
function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore : la persistance est best-effort */
  }
}

/** Construit le ChartState courant depuis les stores. */
function currentChartState(): ChartState {
  const { symbol, timeframe } = marketStore.getState();
  return {
    symbol,
    exchange: "binance",
    timeframe,
    chartType: "candle_solid",
    indicators: indicatorsStore.getState().indicators,
  };
}

export function saveChartState(): void {
  writeJson(CHART_KEY, currentChartState());
}

export function saveWatchlist(): void {
  writeJson(WATCH_KEY, watchlistStore.getState().symbols);
}

/**
 * Restaure les stores depuis localStorage. À appeler AVANT le premier rendu.
 *
 * Si aucun ChartState n'est persisté (première visite), on amorce le Volume
 * @axiom (pane séparé) par défaut : il remplace l'ancien VOL natif et fait de
 * @axiom/indicators la source unique (cf. BUILD-CONTRACT).
 */
export function hydrateStores(): void {
  const persisted = readJson<Partial<ChartState>>(CHART_KEY);

  if (persisted) {
    if (typeof persisted.symbol === "string" && persisted.symbol.length > 0) {
      marketStore.getState().setSymbol(persisted.symbol);
    }
    if (typeof persisted.timeframe === "string") {
      marketStore.getState().setTimeframe(persisted.timeframe as Timeframe);
    }
    if (Array.isArray(persisted.indicators)) {
      // On ne garde que les defId encore présents au registre, et on normalise les params.
      const valid: IndicatorInstance[] = persisted.indicators
        .filter(
          (i): i is IndicatorInstance =>
            !!i && typeof i.defId === "string" && getIndicator(i.defId) !== undefined
        )
        .map((i) => ({
          defId: i.defId,
          params:
            i.params && typeof i.params === "object" ? i.params : defaultParams(i.defId),
        }));
      indicatorsStore.getState().setAll(valid);
    }
  } else {
    indicatorsStore
      .getState()
      .setAll([{ defId: "volume", params: defaultParams("volume") }]);
  }

  const watch = readJson<unknown>(WATCH_KEY);
  if (Array.isArray(watch)) {
    const symbols = watch.filter(
      (s): s is string => typeof s === "string" && s.length > 0
    );
    watchlistStore.getState().setAll(symbols.length > 0 ? symbols : [...DEFAULT_WATCHLIST]);
  }
}

/**
 * Active la sauvegarde automatique. À appeler APRÈS `hydrateStores()`.
 *  - marketStore : sauvegarde uniquement si symbole/timeframe changent (pas sur tick) ;
 *  - indicatorsStore / watchlistStore : sauvegarde à tout changement (basse fréquence).
 */
export function enablePersistence(): void {
  marketStore.subscribe((state, prev) => {
    if (state.symbol !== prev.symbol || state.timeframe !== prev.timeframe) {
      saveChartState();
    }
  });
  indicatorsStore.subscribe(() => saveChartState());
  watchlistStore.subscribe(() => saveWatchlist());
}
