/**
 * Registre des adaptateurs d'exchange + capacités de timeframe par source.
 *
 * - getAdapter(exchange) : renvoie l'IExchangeAdapter de la source demandée
 *   (binance / kraken / coinbase / mexc / twelvedata). LÈVE une erreur explicite pour
 *   toute source non câblée (bybit/okx/deribit présents dans ExchangeId mais sans
 *   adaptateur ici) — le repli silencieux vers Binance masquait des paires servies par
 *   la mauvaise source. L'UI de sélection (Toolbar) ne propose QUE les sources câblées et
 *   la persistance ne restaure que RESTORABLE_EXCHANGES : ce throw est un garde-fou.
 * - SUPPORTED_TIMEFRAMES : source de vérité des TF réellement honorés par CHAQUE
 *   adaptateur (issu de leurs en-têtes). Sert au grisage des boutons TF et au repli
 *   automatique quand on change de source vers un TF non supporté.
 *
 * Intersection sûre (commune aux trois) : 1m, 5m, 15m, 30m, 1h, 4h, 1d.
 */
import type { ExchangeId, IExchangeAdapter, Timeframe } from "@axiom/types";
import { binanceAdapter } from "./binance";
import { bybitAdapter } from "./bybit";
import { okxAdapter } from "./okx";
import { hyperliquidAdapter } from "./hyperliquid";
import { krakenAdapter } from "./kraken";
import { coinbaseAdapter } from "./coinbase";
import { twelveDataAdapter } from "./twelvedata";
import { mexcAdapter } from "./mexc";
import { capitalisationAdapter, TIMEFRAMES_CAPITALISATION } from "./mcapCandles";
import { estSymboleCapitalisation } from "./mcap";
import {
  createSyntheticAdapter,
  parseSyntheticSymbol,
  type SyntheticLegSource,
} from "./synthetic";

/** Adaptateurs câblés (crypto : Binance/Bybit/OKX/Hyperliquid/Kraken/Coinbase/MEXC ; tradfi : Twelve Data). */
const ADAPTERS: Partial<Record<ExchangeId, IExchangeAdapter>> = {
  binance: binanceAdapter,
  bybit: bybitAdapter,
  okx: okxAdapter,
  hyperliquid: hyperliquidAdapter,
  kraken: krakenAdapter,
  coinbase: coinbaseAdapter,
  twelvedata: twelveDataAdapter,
  mexc: mexcAdapter,
  synthetic: createSyntheticAdapter(
    (ex) => ex === "mcap" ? capitalisationAdapter : getAdapter(ex),
    capitalisationAdapter,
  ),
};

/** Adaptateur de la source demandée ; LÈVE si la source n'est pas câblée (pas de repli muet). */
export function getAdapter(exchange: ExchangeId): IExchangeAdapter {
  const adapter = ADAPTERS[exchange];
  if (adapter === undefined) {
    throw new Error(
      `Source '${exchange}' non câblée : aucun adaptateur disponible ` +
        `(sources câblées : ${Object.keys(ADAPTERS).join(", ")}).`
    );
  }
  return adapter;
}

/**
 * TF supportés par source (cf. en-têtes des adaptateurs) :
 *  - Binance : tout le natif (1m..1M) + 3M/6M/12M agrégés côté client depuis 1M.
 *  - Kraken  : jusqu'à 1w (NI 2h/6h/12h, NI 3m/3d, NI 1M/3M+, NI secondes).
 *  - Coinbase: jusqu'à 1d (1m..6h + 1d ; NI 1w/3d/12h, NI 1M/3M+, NI secondes).
 */
export const SUPPORTED_TIMEFRAMES: Partial<Record<ExchangeId, Timeframe[]>> = {
  binance: [
    "1s", "1m", "3m", "5m", "15m", "30m",
    "1h", "2h", "4h", "6h", "12h",
    "1d", "3d", "1w", "1M", "3M", "6M", "12M",
  ],
  // Bybit v5 : natif court→long, INCLUANT 2h/6h/12h (NI secondes, 3m, 3d, 3M+).
  bybit: ["1m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d", "1w", "1M"],
  // OKX v5 : idem Bybit (NI secondes, 3m, 3d, 3M+).
  okx: ["1m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d", "1w", "1M"],
  // Hyperliquid : natif SANS 6h (a 8h à la place, non exposé) ni secondes/3m/3d/3M+.
  hyperliquid: ["1m", "5m", "15m", "30m", "1h", "2h", "4h", "12h", "1d", "1w", "1M"],
  kraken: ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"],
  coinbase: ["1m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "1d"],
  // Twelve Data : intervalles du plan gratuit (inclut 4h ; NI 3M/6M/12M, NI secondes).
  twelvedata: ["1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M"],
  // MEXC : 1h→60m, 1w→1W mappés dans l'adaptateur (NI 2h/6h/12h/3m/3d/3M+, NI secondes).
  mexc: ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M"],
};

const SYNTHETIC_TIMEFRAME_ORDER = SUPPORTED_TIMEFRAMES.binance ?? [];

function timeframesJambe(ex: SyntheticLegSource): Timeframe[] {
  return ex === "mcap" ? TIMEFRAMES_CAPITALISATION : SUPPORTED_TIMEFRAMES[ex] ?? [];
}

/** TF d'un synthétique = intersection des 2 jambes, dans l'ordre de la liste Binance. */
export function syntheticTimeframes(exA: SyntheticLegSource, exB: SyntheticLegSource): Timeframe[] {
  const a = new Set(timeframesJambe(exA));
  const b = new Set(timeframesJambe(exB));
  return SYNTHETIC_TIMEFRAME_ORDER.filter((tf) => a.has(tf) && b.has(tf));
}

/** Point d'entrée unique du grisage TF : table statique, ou intersection si SYN. */
export function supportedTimeframesFor(exchange: ExchangeId, symbol: string): Timeframe[] {
  if (exchange !== "synthetic") return SUPPORTED_TIMEFRAMES[exchange] ?? [];
  if (estSymboleCapitalisation(symbol)) return TIMEFRAMES_CAPITALISATION;
  const spec = parseSyntheticSymbol(symbol);
  if (spec === null) return [];
  return syntheticTimeframes(spec.exA, spec.exB);
}
