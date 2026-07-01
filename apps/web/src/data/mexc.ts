/**
 * Adaptateur MEXC (spot v3) — implémente IExchangeAdapter (@axiom/types).
 * Exchange CRYPTO dont le catalogue inclut des ACTIONS TOKENISÉES (familles `…X` et
 * `…ON`, ex. AAPLXUSDT, TSLAONUSDT, SPYXUSDT) chartables comme n'importe quelle paire.
 *
 * - API publique KEYLESS : klines/exchangeInfo en lecture seule ne nécessitent ni
 *   compte ni clé (la clé+secret HMAC ne servent qu'aux endpoints privés : ordres/solde).
 * - L'API spot v3 est compatible Binance (`/api/v3/klines` → même tuple). MAIS MEXC
 *   N'ENVOIE PAS d'en-tête CORS → on passe par le proxy /mexcapi (cf. vite.config.ts).
 * - Live : le WS spot MEXC est en PROTOBUF (lourd à décoder) → on fait du POLLING REST
 *   de la bougie courante (comme l'adaptateur Twelve Data). subscribeTrades = no-op
 *   (pas de flux tick → orderflow/footprint inactifs).
 *
 * Intervalles MEXC ≠ Binance pour deux cas : 1h→`60m`, 1w→`1W` (et pas de 2h/6h/12h/3m/3d).
 */
import type { Candle, IExchangeAdapter, Timeframe, Unsubscribe } from "@axiom/types";
import { pollLoop } from "./pollLoop";

/** Base proxifiée (same-origin) — cf. proxy "/mexcapi" dans vite.config.ts. */
const KLINES_URL = "/mexcapi/api/v3/klines";

/** Cadence du polling de la bougie courante (crypto/tokenisé : ~5 s reste léger). */
const POLL_MS = 5_000;

/** TF AXIOM → interval MEXC. Seuls ces TF sont déclarés supportés (cf. adapters.ts). */
const TF_MAP: Partial<Record<Timeframe, string>> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "60m", // MEXC : pas de "1h"
  "4h": "4h",
  "1d": "1d",
  "1w": "1W", // MEXC : "1W" majuscule
  "1M": "1M",
};

/**
 * Tuple klines MEXC (compatible Binance, 8 champs utiles) :
 * [openTime, open, high, low, close, volume, closeTime, quoteVolume].
 */
type MexcKline = [number, string, string, string, string, string, number, string];

/**
 * Parse la réponse klines (tableau de tuples) en bougies AXIOM. PURE & testée.
 *  - barres non numériques écartées ; `closed` dérivé de closeTime < maintenant ;
 *  - tri ascendant par temps (défensif).
 */
export function parseMexcKlines(raw: unknown, now: number): Candle[] {
  if (!Array.isArray(raw)) return [];
  const out: Candle[] = [];
  for (const k of raw as MexcKline[]) {
    if (!Array.isArray(k)) continue;
    const time = Number(k[0]);
    const open = Number(k[1]);
    const high = Number(k[2]);
    const low = Number(k[3]);
    const close = Number(k[4]);
    const volume = Number(k[5]);
    const closeTime = Number(k[6]);
    if (![time, open, high, low, close].every((n) => Number.isFinite(n))) continue;
    out.push({
      time,
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) ? volume : 0,
      quoteVolume: Number.isFinite(Number(k[7])) ? Number(k[7]) : undefined,
      closed: Number.isFinite(closeTime) ? closeTime < now : false,
    });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

/** GET + parse des klines pour (symbole, interval, limit). */
async function fetchKlines(
  symbol: string,
  interval: string,
  limit: number,
  signal?: AbortSignal
): Promise<Candle[]> {
  const params = new URLSearchParams({
    symbol: symbol.toUpperCase(),
    interval,
    limit: String(limit),
  });
  const res = await fetch(`${KLINES_URL}?${params.toString()}`, { signal });
  if (!res.ok) throw new Error(`MEXC ${res.status} ${res.statusText}`);
  return parseMexcKlines(await res.json(), Date.now());
}

export const mexcAdapter: IExchangeAdapter = {
  id: "mexc",

  async fetchKlines(symbol, tf, opts) {
    const interval = TF_MAP[tf] ?? "1d";
    const limit = Math.min(opts?.limit ?? 500, 1000);
    return fetchKlines(symbol, interval, limit);
  },

  // WS spot MEXC = protobuf → POLLING REST de la bougie courante.
  subscribeKline(symbol, tf, cb) {
    const interval = TF_MAP[tf] ?? "1d";
    // Avec limit=2, candles[0] est déjà correctement closed:true dès que closeTime est
    // dépassé. On la ré-émet ici (une seule fois, via lastClosedTime) AVANT la barre en
    // cours, sinon elle n'est jamais transmise et les indicateurs ne recalculent plus.
    let lastClosedTime: number | null = null;

    return pollLoop(async (signal, isCancelled) => {
      const candles = await fetchKlines(symbol, interval, 2, signal);
      if (isCancelled() || candles.length === 0) return;
      const prev = candles.length >= 2 ? candles[candles.length - 2] : undefined;
      if (prev && prev.closed && (lastClosedTime === null || prev.time > lastClosedTime)) {
        lastClosedTime = prev.time;
        cb(prev);
      }
      const last = candles[candles.length - 1];
      if (!isCancelled() && last) cb(last);
    }, POLL_MS);
  },

  // Pas de flux tick (WS protobuf non implémenté) → orderflow/footprint inactifs.
  subscribeTrades(): Unsubscribe {
    return () => {};
  },
};
