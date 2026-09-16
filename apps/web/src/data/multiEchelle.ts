/**
 * Concordance multi-échelle (section BRIEF) — lecture PURE de quatre timeframes du
 * symbole courant : tendance (close vs EMA 50), RSI(14), ATR%(14) et variation sur
 * la fenêtre. Aucun nouvel indicateur : les mesures passent par `@axiom/indicators`
 * (source de vérité du calcul) sur des bougies chargées à la demande.
 *
 * Objet : voir si les échelles RACONTENT LA MÊME CHOSE — pas produire un signal.
 * Une concordance 4/4 ne préjuge ni de la direction future ni de la qualité d'une
 * entrée ; c'est un contrôle de cohérence avant de lire un setup (un RSI survendu en
 * 15 min contre une tendance 1 j baissière n'a pas le même sens qu'aligné).
 *
 * L'échec d'UNE échelle n'invalide pas les autres : la mesure manquante reste `null`
 * et l'affichage la marque « — » (jamais de valeur inventée, jamais de pane muet).
 */

import type { Candle, ExchangeId, Timeframe } from "@axiom/types";
import { computeIndicator, getIndicator } from "@axiom/indicators";
import { getAdapter } from "./adapters";

/** Échelles lues par la section, de la plus fine à la plus large. */
export const ECHELLES_MTF: readonly Timeframe[] = ["15m", "1h", "4h", "1d"];

/** Bougies demandées par échelle (EMA 50 + RSI 14 + ATR 14 + fenêtre de variation). */
export const BOUGIES_MTF = 200;

/** Barres de la variation affichée (Δ sur 20 barres de l'échelle). */
export const FENETRE_VARIATION = 20;

/** En dessous de ce nombre de bougies, l'échelle n'est pas mesurable (amorçages). */
export const MIN_BOUGIES_MTF = 60;

export interface MesureEchelle {
  timeframe: Timeframe;
  /** close vs EMA(50) : "hausse" au-dessus, "baisse" en-dessous, null si indéfini. */
  tendance: "hausse" | "baisse" | null;
  rsi: number | null;
  /** ATR(14) en % du dernier close. */
  atrPct: number | null;
  /** Variation du dernier close sur `FENETRE_VARIATION` barres, en %. */
  variationPct: number | null;
  bougies: number;
}

export interface ConcordanceEchelles {
  /** Échelle de référence : la plus large mesurable (la tendance de fond). */
  reference: Timeframe | null;
  direction: "hausse" | "baisse" | null;
  /** Nombre d'échelles mesurables alignées sur la tendance de référence. */
  alignees: number;
  /** Nombre d'échelles mesurables (tendance définie). */
  total: number;
}

/** Une échelle lue : sa mesure, ou null si le chargement/la mesure a échoué. */
export interface EchelleLue {
  timeframe: Timeframe;
  mesure: MesureEchelle | null;
}

/** Dernière valeur définie d'une série, ou null. PURE. */
function derniere(serie: Array<number | undefined> | undefined): number | null {
  if (serie === undefined) return null;
  for (let i = serie.length - 1; i >= 0; i--) {
    const v = serie[i];
    if (v !== undefined && Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * Mesure une échelle à partir de ses bougies. Renvoie null si la série est trop
 * courte (< MIN_BOUGIES_MTF) — l'appelant affiche « — » plutôt qu'une valeur douteuse.
 * PURE (aucun fetch).
 */
export function mesurerEchelle(timeframe: Timeframe, candles: readonly Candle[]): MesureEchelle | null {
  if (candles.length < MIN_BOUGIES_MTF) return null;
  const serie = [...candles];

  const ema = getIndicator("ema");
  const rsi = getIndicator("rsi");
  const atr = getIndicator("atr");
  if (ema === undefined || rsi === undefined || atr === undefined) return null;

  const ema50 = derniere(computeIndicator(ema, serie, { length: 50, source: "close" }).series.ema);
  const rsi14 = derniere(computeIndicator(rsi, serie, { length: 14 }).series.rsi);
  const atr14 = derniere(computeIndicator(atr, serie, { length: 14 }).series.atr);

  const dernier = serie[serie.length - 1];
  const close = dernier?.close ?? null;
  if (close === null || !(close > 0)) return null;

  const tendance = ema50 === null ? null : close >= ema50 ? "hausse" : "baisse";
  const atrPct = atr14 === null ? null : (atr14 / close) * 100;

  const reference = serie[serie.length - 1 - FENETRE_VARIATION];
  const variationPct =
    reference !== undefined && reference.close > 0
      ? ((close - reference.close) / reference.close) * 100
      : null;

  return { timeframe, tendance, rsi: rsi14, atrPct, variationPct, bougies: serie.length };
}

/**
 * Concordance des échelles : référence = la plus LARGE mesurable (tendance de fond),
 * alignées = échelles de même tendance. Une échelle sans tendance ne compte pas dans
 * le total. PURE.
 */
export function concordanceEchelles(mesures: readonly MesureEchelle[]): ConcordanceEchelles {
  const definies = mesures.filter((m) => m.tendance !== null);
  const reference = definies[definies.length - 1] ?? null;
  if (reference === null) return { reference: null, direction: null, alignees: 0, total: 0 };
  const direction = reference.tendance;
  const alignees = definies.filter((m) => m.tendance === direction).length;
  return { reference: reference.timeframe, direction, alignees, total: definies.length };
}

/**
 * Charge les bougies des quatre échelles via l'adaptateur de la source et mesure
 * chacune. Une échelle en échec (réseau, symbole non listé) reste `mesure: null` —
 * la section affiche « — » pour elle et les autres restent lisibles. L'ordre de
 * ECHELLES_MTF est conservé ; le résultat a toujours la même longueur que `echelles`.
 */
export async function chargerMultiEchelle(
  exchange: ExchangeId,
  symbol: string,
  signal?: AbortSignal,
  echelles: readonly Timeframe[] = ECHELLES_MTF,
): Promise<EchelleLue[]> {
  const adapter = getAdapter(exchange);
  return Promise.all(
    echelles.map(async (timeframe): Promise<EchelleLue> => {
      try {
        const candles = await adapter.fetchKlines(symbol, timeframe, { limit: BOUGIES_MTF });
        if (signal?.aborted) return { timeframe, mesure: null };
        return { timeframe, mesure: mesurerEchelle(timeframe, candles) };
      } catch {
        return { timeframe, mesure: null };
      }
    }),
  );
}
