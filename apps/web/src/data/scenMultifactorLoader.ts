/** Collecte isolée du mode SCEN multifactoriel : sources exactes, sans watchlist. */
import type { ExchangeId } from "@axiom/types";
import { getAdapter } from "./adapters";
import { chargerSerieMacro } from "./macro/chargerSerieMacro";
import { seriesDeIndicateur } from "./macro/catalogueMacro";
import { TWELVEDATA_SYMBOLS } from "./pairs";
import type { PositionBrute } from "./scen";
import { estimerMultifactoriel, type EstimationMulti, type FacteurMultiId, type SerieMulti } from "./scenMultifactor";
import { QUOTE_ASSETS, splitSymbol } from "./symbol";

export const FACTEURS_MULTI: readonly { id: FacteurMultiId; label: string; symbol: string; source: ExchangeId | "fred"; quote: string }[] = [
  { id: "btc", label: "BTC spot Binance", symbol: "BTCUSDT", source: "binance", quote: "USDT" },
  { id: "eth", label: "ETH spot Binance", symbol: "ETHUSDT", source: "binance", quote: "USDT" },
  { id: "spx", label: "Actions US (SPY, proxy ETF)", symbol: "SPY", source: "twelvedata", quote: "USD" },
  { id: "dxy", label: "Dollar (UUP, proxy ETF)", symbol: "UUP", source: "twelvedata", quote: "USD" },
  { id: "or", label: "Or (GLD, proxy ETF)", symbol: "GLD", source: "twelvedata", quote: "USD" },
  { id: "taux", label: "Taux réel US 10 ans (DFII10)", symbol: "DFII10", source: "fred", quote: "%" },
];
export interface LigneMulti { position: PositionBrute; devise: string; valeurSignee: number | null; datePrix: string | null; estimation: EstimationMulti }
export interface CollecteMulti { lignes: LigneMulti[]; facteurs: Partial<Record<FacteurMultiId, SerieMulti>>; recupereLe: number; maintenant: number }
const JOUR = 86_400_000;
export function cotationScen(symbole: string, source: ExchangeId): string | null {
  const s = symbole.trim().toUpperCase();
  if (source === "twelvedata") {
    if (s.includes("/")) {
      try {
        const { base, quote } = splitSymbol(s, "SCEN");
        return /^[A-Z]{3}$/.test(base) && /^[A-Z]{3}$/.test(quote) || s === "WTI/USD" ? quote : null;
      } catch { return null; }
    }
    // Seuls les ETF/actions US du catalogue curé ont une cotation USD connue.
    return TWELVEDATA_SYMBOLS.includes(s) ? "USD" : null;
  }
  try {
    const normalise = s.replace("-", "/");
    const { base, quote } = splitSymbol(normalise, "SCEN");
    return /^[A-Z0-9]{2,20}$/.test(base) && QUOTE_ASSETS.includes(quote) ? quote : null;
  } catch { return null; }
}
function cle(symbol: string, source: ExchangeId, quote: string): string { return JSON.stringify([symbol, source, quote, "1d"]); }
function serieDepuisCandles(symbol: string, source: ExchangeId, quote: string, candles: readonly { time: number; close: number }[]): SerieMulti {
  return { identite: { symbol, source, quote, session: source === "twelvedata" ? "date-tradfi" : "UTC", convention: "close-1d" }, unite: "prix",
    // Une clôture non finie/non positive reste une barrière de dates pour le moteur.
    points: candles.filter((c) => Number.isFinite(c.time) && Number.isFinite(new Date(c.time).getTime()))
      .map((c) => ({ date: new Date(c.time).toISOString().slice(0, 10), valeur: c.close })).sort((a, b) => a.date.localeCompare(b.date)) };
}
export async function collecterMultifactoriel(positions: readonly PositionBrute[], selection: readonly FacteurMultiId[], fenetreJours: 90 | 180 | 365, signal?: AbortSignal): Promise<CollecteMulti> {
  const maintenant = Date.now();
  const demandes = new Map<string, { symbol: string; source: ExchangeId; quote: string }>();
  for (const p of positions) {
    const quote = cotationScen(p.symbole, p.source);
    if (quote === null) continue;
    demandes.set(cle(p.symbole, p.source, quote), { symbol: p.symbole, source: p.source, quote });
  }
  for (const id of selection) {
    const f = FACTEURS_MULTI.find((v) => v.id === id);
    if (f && f.source !== "fred") demandes.set(cle(f.symbol, f.source, f.quote), { symbol: f.symbol, source: f.source, quote: f.quote });
  }
  const series = new Map<string, SerieMulti>();
  const valorisations = new Map<string, { date: string; valeur: number } | null>();
  await Promise.all([...demandes.entries()].map(async ([key, d]) => {
    try {
      const candles = await getAdapter(d.source).fetchKlines(d.symbol, "1d", { limit: 500 });
      if (!signal?.aborted && candles.length > 0) {
        series.set(key, serieDepuisCandles(d.symbol, d.source, d.quote, candles));
        const dernierConnu = candles.filter((c) => Number.isFinite(c.time) && Number.isFinite(new Date(c.time).getTime()) && c.time <= maintenant).sort((a, b) => a.time - b.time).at(-1);
        valorisations.set(key, dernierConnu && Number.isFinite(dernierConnu.close) && dernierConnu.close > 0
          ? { date: new Date(dernierConnu.time).toISOString().slice(0, 10), valeur: dernierConnu.close } : null);
      }
    } catch { /* Série absente, jamais remplacée par un homonyme. */ }
  }));
  const facteurs: Partial<Record<FacteurMultiId, SerieMulti>> = {};
  for (const id of selection) {
    const f = FACTEURS_MULTI.find((v) => v.id === id);
    if (!f) continue;
    if (f.source === "fred") {
      const def = seriesDeIndicateur("taux-reel-us").find((v) => v.id === "taux-reel-us-us");
      if (!def) continue;
      const result = await chargerSerieMacro(def, maintenant - (fenetreJours + 30) * JOUR, signal);
      if (result.statut === "ok" && !signal?.aborted) facteurs[id] = { identite: { symbol: "DFII10", source: "fred", quote: "%", session: "date", convention: "observation" }, unite: "taux-pct", points: result.points.map((p) => ({ date: new Date(p.time).toISOString().slice(0, 10), valeur: p.value })) };
    } else facteurs[id] = series.get(cle(f.symbol, f.source, f.quote));
  }
  if (signal?.aborted) throw new DOMException("Annulé", "AbortError");
  const lignes = positions.map((position): LigneMulti => {
    const devise = cotationScen(position.symbole, position.source);
    const key = devise === null ? null : cle(position.symbole, position.source, devise);
    const s = key === null ? undefined : series.get(key);
    const point = key === null ? null : valorisations.get(key);
    const valeurSignee = point && Number.isFinite(position.taille) && position.taille > 0 ? (position.direction === "short" ? -1 : 1) * position.taille * point.valeur : null;
    const estimation = s ? estimerMultifactoriel({ actif: s, facteurs, selection, fenetreJours, maintenant })
      : { statut: "indisponible", raison: devise === null ? "devise de cotation inconnue" : "série de l'actif absente", facteurs: [...selection], beta: {}, alpha: null, r2: null, r2Ajuste: null, sigma: null, vif: {}, n: 0, nonAppariees: 0, excluesInvalides: 0, pairesLongues: 0, dureesJours: null, periode: null, stabilite: "non-estimable", betaMoitie: null } as EstimationMulti;
    return { position, devise: devise ?? "inconnue", valeurSignee, datePrix: point?.date ?? null, estimation };
  });
  return { lignes, facteurs, recupereLe: Date.now(), maintenant };
}
