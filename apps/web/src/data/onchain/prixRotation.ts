/** Comparaison distincte au token de référence spot ; Base n'en a aucun. */
import type { Candle } from "@axiom/types";
import { binanceAdapter } from "../binance";
import { referencePrixChaine } from "./rotationChaines";
import type { ChaineEconomieId } from "./economieChaines";

const JOUR = 86_400_000;
export interface PrixRotation { symbol: string; source: "Binance spot"; unite: "USDT"; periode: "1d"; dateDebut: number; dateFin: number; prixDebut: number; prixFin: number; variationPct: number }
export interface SourcePrixRotation { fetchKlines(symbol: string, tf: "1d", opts: { limit: number; endTime: number }): Promise<Candle[]> }

/** `Candle.time` est l'ouverture de la période UTC ; le prix n'est connu qu'après sa clôture. */
export function comparerPrixRotation(symbol: string, dateDebut: number, dateFin: number, candles: readonly Pick<Candle, "time" | "close" | "closed">[], maintenant: number): PrixRotation | null {
  if (!Number.isFinite(dateDebut) || !Number.isFinite(dateFin) || dateDebut >= dateFin) return null;
  const admissible = (c: Pick<Candle, "time" | "close" | "closed">): boolean => c.closed === true && c.time + JOUR <= maintenant && Number.isFinite(c.close) && c.close > 0;
  const debut = candles.find((c) => c.time === dateDebut && admissible(c));
  const fin = candles.find((c) => c.time === dateFin && admissible(c));
  if (!debut || !fin) return null;
  return { symbol, source: "Binance spot", unite: "USDT", periode: "1d", dateDebut, dateFin,
    prixDebut: debut.close, prixFin: fin.close, variationPct: 100 * (fin.close / debut.close - 1) };
}

export async function chargerPrixRotation(id: ChaineEconomieId, dateDebut: number, dateFin: number, maintenant: number, source: SourcePrixRotation = binanceAdapter): Promise<PrixRotation | null> {
  const symbol = referencePrixChaine(id);
  if (symbol === null || !Number.isFinite(dateDebut) || !Number.isFinite(dateFin) || dateFin >= maintenant) return null;
  try {
    const jours = Math.ceil((dateFin - dateDebut) / JOUR);
    const candles = await source.fetchKlines(symbol, "1d", { limit: Math.min(1000, jours + 5), endTime: dateFin + JOUR - 1 });
    return comparerPrixRotation(symbol, dateDebut, dateFin, candles, maintenant);
  } catch { return null; }
}
