/**
 * @axiom/indicators — strategy/fixtures/btcusdt4h.ts
 *
 * Cas de référence d'AXIS S/R (conception du 2026-11-09, §6.4) : 3 000 bougies BTCUSDT 4h de
 * Binance Spot, de l'ouverture du 2025-06-19T00:00Z à celle du 2026-10-31T20:00Z, lues dans
 * `btcusdt-4h-3000.json` (fichier versé tel quel, jamais modifié). Réservé aux tests : ni
 * `stratAxisSr.ts` ni `index.ts` ne l'importent, il n'entre donc pas dans le paquet web.
 */
import type { Candle } from "@axiom/types";
import brut from "./btcusdt-4h-3000.json";

/** Une ligne du JSON, colonnes `time`, `open`, `high`, `low`, `close`, `volume`, `buyVolume`. */
type LigneBougie = [time: number, open: number, high: number, low: number, close: number, volume: number, buyVolume: number];

/** Les 3 000 bougies, toutes closes ; `sellVolume = volume − buyVolume`. */
export function bougiesBtcusdt4h(): Candle[] {
  return (brut.bougies as LigneBougie[]).map(([time, open, high, low, close, volume, buyVolume]) => ({
    time,
    open,
    high,
    low,
    close,
    volume,
    buyVolume,
    sellVolume: volume - buyVolume,
    closed: true,
  }));
}
