import type { ReglementFunding } from "@axiom/backtest";
import type { Candle, Timeframe } from "@axiom/types";
import { extUrl } from "./extapi";

const LIMITE_BINANCE = 1000;
const LIMITE_KLINES = 1500;

function attendre(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse les klines USDⓈ-M et applique la borne de CLOSE `[debutMs, finMs)`. */
export function parseKlinesPerpBinance(brut: unknown, debutMs: number, finMs: number): Candle[] {
  if (!Array.isArray(brut)) throw new Error("Réponse klines perp Binance invalide.");
  const resultat: Candle[] = [];
  for (const ligne of brut) {
    if (!Array.isArray(ligne) || ligne.length < 11) throw new Error("Kline perp Binance invalide.");
    const time = Number(ligne[0]);
    const closeTime = Number(ligne[6]);
    const open = Number(ligne[1]);
    const high = Number(ligne[2]);
    const low = Number(ligne[3]);
    const close = Number(ligne[4]);
    const volume = Number(ligne[5]);
    const quoteVolume = Number(ligne[7]);
    const trades = Number(ligne[8]);
    const buyVolume = Number(ligne[9]);
    if (![time, closeTime, open, high, low, close, volume, quoteVolume, trades, buyVolume].every(Number.isFinite)) {
      throw new Error("Valeur de kline perp Binance non finie.");
    }
    if (time < debutMs || closeTime + 1 > finMs) continue;
    resultat.push({
      time, open, high, low, close, volume, quoteVolume, trades, buyVolume,
      sellVolume: volume - buyVolume,
      closed: true,
    });
  }
  return resultat;
}

/** Historique de PRIX perp linéaire, distinct des bougies spot. */
export async function accumulerKlinesPerpBinance(
  symbol: string,
  timeframe: Timeframe,
  debutMs: number,
  finMs: number,
  options: { signal?: AbortSignal; onProgress?: (nombre: number) => void; fetcher?: typeof fetch } = {},
): Promise<Candle[]> {
  const fetcher = options.fetcher ?? fetch;
  const normalise = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9]+USDT$/.test(normalise)) throw new Error("Perp Binance USDT requis.");
  const parTemps = new Map<number, Candle>();
  let endTime = finMs - 1;
  while (endTime >= debutMs && parTemps.size < 50_000) {
    if (options.signal?.aborted) throw new DOMException("Accumulation annulée", "AbortError");
    const query = new URLSearchParams({ symbol: normalise, interval: timeframe, endTime: String(endTime), limit: String(LIMITE_KLINES) });
    const response = await fetcher(extUrl("fapi.binance.com", `fapi/v1/klines?${query.toString()}`), { signal: options.signal });
    if (!response.ok) throw new Error(`Klines perp Binance indisponibles (${response.status}).`);
    const brut: unknown = await response.json();
    const toutes = Array.isArray(brut) ? brut : [];
    const lot = parseKlinesPerpBinance(toutes, debutMs, finMs);
    for (const candle of lot) parTemps.set(candle.time, candle);
    options.onProgress?.(parTemps.size);
    const premiere = toutes[0];
    const plusAncienOpen = Array.isArray(premiere) ? Number(premiere[0]) : Number.NaN;
    if (toutes.length < LIMITE_KLINES || !Number.isFinite(plusAncienOpen) || plusAncienOpen <= debutMs) break;
    endTime = plusAncienOpen - 1;
    await attendre(120);
  }
  return [...parTemps.values()].sort((a, b) => a.time - b.time).slice(-50_000);
}

export interface CouvertureFundingBacktest {
  debutMs: number;
  finMs: number;
  nombre: number;
  source: "Binance USDⓈ-M fundingRate";
}

export interface HistoriqueFundingBacktest {
  reglements: ReglementFunding[];
  couverture: CouvertureFundingBacktest;
}

/** Parse sans proxy de prix : `markPrice` doit venir du règlement Binance lui-même. */
export function parseReglementsFundingBinance(brut: unknown): ReglementFunding[] {
  if (!Array.isArray(brut)) throw new Error("Réponse funding Binance invalide.");
  const resultat: ReglementFunding[] = [];
  for (const ligne of brut) {
    if (typeof ligne !== "object" || ligne === null) throw new Error("Ligne funding Binance invalide.");
    const objet = ligne as Record<string, unknown>;
    const temps = Number(objet.fundingTime);
    const taux = Number(objet.fundingRate);
    const mark = Number(objet.markPrice);
    if (!Number.isFinite(temps)) throw new Error("fundingTime Binance invalide.");
    if (!Number.isFinite(taux)) throw new Error("fundingRate Binance invalide.");
    if (objet.markPrice === undefined || objet.markPrice === null || objet.markPrice === "" || !Number.isFinite(mark) || mark <= 0) {
      throw new Error("markPrice Binance absent ou invalide ; aucun proxy n'est inventé.");
    }
    resultat.push({ temps, taux, mark, tempsMark: temps });
  }
  resultat.sort((a, b) => a.temps - b.temps);
  for (let i = 1; i < resultat.length; i++) {
    if (resultat[i]!.temps === resultat[i - 1]!.temps) throw new Error("Règlement funding Binance dupliqué.");
  }
  return resultat;
}

/** Télécharge l'historique USDⓈ-M sur [debutMs, finMs], pagination avant calcul. */
export async function fetchReglementsFundingBinance(
  symbol: string,
  debutMs: number,
  finMs: number,
  fetcher: typeof fetch = fetch,
): Promise<HistoriqueFundingBacktest> {
  if (!Number.isFinite(debutMs) || !Number.isFinite(finMs) || debutMs > finMs) {
    throw new Error("Bornes funding invalides.");
  }
  const normalise = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9]+USDT$/.test(normalise)) throw new Error("Funding réel disponible uniquement pour les perps Binance USDT.");

  const parTemps = new Map<number, ReglementFunding>();
  let curseur = debutMs;
  while (curseur <= finMs) {
    const query = new URLSearchParams({
      symbol: normalise,
      startTime: String(curseur),
      endTime: String(finMs),
      limit: String(LIMITE_BINANCE),
    });
    const response = await fetcher(extUrl("fapi.binance.com", `fapi/v1/fundingRate?${query.toString()}`));
    if (!response.ok) throw new Error(`Funding Binance indisponible (${response.status}).`);
    const lot = parseReglementsFundingBinance(await response.json());
    for (const reglement of lot) {
      if (reglement.temps >= debutMs && reglement.temps <= finMs) parTemps.set(reglement.temps, reglement);
    }
    if (lot.length < LIMITE_BINANCE) break;
    const dernier = lot.at(-1)?.temps;
    if (dernier === undefined || dernier < curseur) throw new Error("Pagination funding Binance incohérente.");
    curseur = dernier + 1;
  }

  const reglements = [...parTemps.values()].sort((a, b) => a.temps - b.temps);
  if (reglements.length === 0) throw new Error("Aucun règlement funding/mark dans la fenêtre demandée.");
  return {
    reglements,
    couverture: {
      debutMs: reglements[0]!.temps,
      finMs: reglements.at(-1)!.temps,
      nombre: reglements.length,
      source: "Binance USDⓈ-M fundingRate",
    },
  };
}
