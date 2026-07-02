/**
 * EQS — Screener d'actifs (logique PURE, testable hors navigateur).
 *
 * Univers : 1 requête Binance `/api/v3/ticker/24hr` (tous les symboles spot, CORS *),
 * filtrée sur les cotations USDT/USDC. Le funding des perpétuels est fusionné depuis
 * 1 requête `fapi/v1/premiumIndex` (via le proxy /extapi, fapi n'expose pas de CORS).
 *
 * Deux étages de filtres :
 *  1. FILTRES DE BASE (sans klines) : volume 24h, |Δ24h|, prix, funding — évalués ici,
 *     sur le résultat du ticker (coût : 2 requêtes au total pour tout l'univers).
 *  2. FILTRES INDICATEURS (RSI / EMA / MACD sur un TF choisi) : évalués dans un Web
 *     Worker (screener.worker.ts) sur les CANDIDATS retenus par l'étage 1, plafonnés
 *     à `SCREENER_CAP` symboles (une requête klines par symbole, débit ~10 req/s).
 *
 * Ce module ne fait AUCUN fetch : il n'expose que des types, constantes et fonctions
 * pures (parsing, comparaison, sélection). Les effets réseau vivent dans store/worker.
 */
import type { Candle, Timeframe } from "@axiom/types";

// ─────────────────────────── Constantes de run ───────────────────────────

/** Cotations screenées (le volume en quote ≈ volume USD pour ces paires). */
export const SCREENER_QUOTES = ["USDT", "USDC"] as const;
export type ScreenerQuote = (typeof SCREENER_QUOTES)[number];

/**
 * Plafond de symboles envoyés à l'étage indicateurs (une requête klines chacun).
 * Choisi pour tenir un run en quelques secondes à ~10 req/s. Affiché honnêtement
 * dans l'UI : au-delà, seuls les N plus liquides sont évalués sur indicateurs.
 */
export const SCREENER_CAP = 60;

/** Timeframes proposés à l'étage indicateurs (intervalles NATIFS Binance uniquement). */
export const SCREENER_TIMEFRAMES: Timeframe[] = ["15m", "1h", "4h", "1d"];

/** Nombre de bougies récupérées par symbole (couvre l'amorce RSI/EMA/MACD avec marge). */
export const SCREENER_KLINE_LIMIT = 200;

// ─────────────────────────── Univers (ticker 24h) ───────────────────────────

/** Ligne brute de `/api/v3/ticker/24hr` (sous-ensemble des champs exploités). */
export interface Ticker24hRaw {
  symbol?: unknown;
  lastPrice?: unknown;
  priceChangePercent?: unknown;
  quoteVolume?: unknown;
}

/** Une ligne du screener (métriques de base + valeurs d'indicateurs si évaluées). */
export interface ScreenerRow {
  symbol: string;
  quote: ScreenerQuote;
  lastPrice: number;
  /** Variation 24h en pourcentage (signée). */
  priceChangePct24h: number;
  /** Volume 24h en cotation (≈ USD pour USDT/USDC). */
  volumeUsd24h: number;
  /** Funding en pourcentage (dernier taux), présent seulement si un perp est trouvé. */
  fundingPct?: number;
  /** Valeurs d'indicateurs calculées par le worker (affichées dans la table). */
  indicatorValues?: IndicatorValue[];
}

/** Valeur d'un indicateur évalué pour une ligne (libellé + scalaire). */
export interface IndicatorValue {
  label: string;
  value: number;
}

/**
 * Parse la réponse `/api/v3/ticker/24hr` en lignes de screener, filtrées sur les
 * cotations demandées. Ignore les entrées mal formées (champs manquants / non finis).
 */
export function parseTicker24h(
  raw: unknown,
  quotes: readonly ScreenerQuote[] = SCREENER_QUOTES,
): ScreenerRow[] {
  if (!Array.isArray(raw)) return [];
  const out: ScreenerRow[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const t = entry as Ticker24hRaw;
    if (typeof t.symbol !== "string") continue;
    const symbol = t.symbol;
    // La cotation doit être un SUFFIXE strict (base non vide) : « BTCUSDT » → USDT.
    const quote = quotes.find((q) => symbol.endsWith(q) && symbol.length > q.length);
    if (quote === undefined) continue;

    const lastPrice = Number(t.lastPrice);
    const volumeUsd24h = Number(t.quoteVolume);
    if (!Number.isFinite(lastPrice) || !Number.isFinite(volumeUsd24h)) continue;
    const pct = Number(t.priceChangePercent);

    out.push({
      symbol,
      quote,
      lastPrice,
      priceChangePct24h: Number.isFinite(pct) ? pct : 0,
      volumeUsd24h,
    });
  }
  return out;
}

// ─────────────────────────── Funding (premiumIndex) ───────────────────────────

/** Entrée brute de `fapi/v1/premiumIndex`. */
export interface PremiumIndexRaw {
  symbol?: unknown;
  lastFundingRate?: unknown;
}

/**
 * Parse `fapi/v1/premiumIndex` en table `symbole → funding %`. Le symbole perpétuel
 * USDⓈ-M partage l'écriture du symbole spot (« BTCUSDT » → « BTCUSDT »), la fusion se
 * fait donc par égalité de chaîne. Le taux brut (fraction) est converti en pourcentage.
 */
export function parsePremiumIndex(raw: unknown): Map<string, number> {
  const map = new Map<string, number>();
  if (!Array.isArray(raw)) return map;
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const e = entry as PremiumIndexRaw;
    if (typeof e.symbol !== "string") continue;
    const rate = Number(e.lastFundingRate);
    if (Number.isFinite(rate)) map.set(e.symbol, rate * 100);
  }
  return map;
}

/** Annote (en place) chaque ligne avec son funding % si un perp correspondant existe. */
export function applyFunding(rows: ScreenerRow[], fundingBySymbol: Map<string, number>): void {
  for (const row of rows) {
    const f = fundingBySymbol.get(row.symbol);
    if (f !== undefined) row.fundingPct = f;
  }
}

// ─────────────────────────── Modèle de filtres ───────────────────────────

/** Opérateurs de comparaison numériques. */
export type Operator = ">" | ">=" | "<" | "<=";
export const OPERATORS: Operator[] = [">", ">=", "<", "<="];

/** Champ screené par un filtre de BASE (sans klines). */
export type BaseField =
  | "volumeUsd24h"
  | "priceChangePct24h"
  | "absPriceChangePct24h"
  | "lastPrice"
  | "fundingPct";

/** Métadonnées d'affichage des champs de base (ordre = ordre du sélecteur). */
export const BASE_FIELDS: { id: BaseField; label: string; unit: string }[] = [
  { id: "volumeUsd24h", label: "Volume 24h", unit: "$" },
  { id: "priceChangePct24h", label: "Δ 24h", unit: "%" },
  { id: "absPriceChangePct24h", label: "|Δ 24h|", unit: "%" },
  { id: "lastPrice", label: "Prix", unit: "" },
  { id: "fundingPct", label: "Funding", unit: "%" },
];

/** Une condition de base : `champ op valeur`. */
export interface BaseCondition {
  kind: "base";
  field: BaseField;
  op: Operator;
  value: number;
}

/**
 * Champ screené par un filtre INDICATEUR : rattaché à un `IndicatorDef` de
 * @axiom/indicators, avec la clé de sortie lue et la manière d'en dériver un scalaire.
 *  - "last"    : dernière valeur définie de la série (RSI, histogramme MACD…) ;
 *  - "distPct" : écart en % entre le dernier close et la valeur (prix vs EMA).
 */
export interface IndicatorFieldSpec {
  id: string;
  label: string;
  /** id du def dans @axiom/indicators. */
  indicatorId: string;
  /** clé de série de sortie lue. */
  output: string;
  /** input principal configurable (ex. « length »), s'il existe. */
  paramKey?: string;
  defaultParam?: number;
  derive: "last" | "distPct";
  unit: string;
}

/** Catalogue curé des champs indicateurs screenables (RSI / EMA / MACD). */
export const INDICATOR_FIELDS: IndicatorFieldSpec[] = [
  {
    id: "rsi",
    label: "RSI",
    indicatorId: "rsi",
    output: "rsi",
    paramKey: "length",
    defaultParam: 14,
    derive: "last",
    unit: "",
  },
  {
    id: "macdHist",
    label: "MACD hist",
    indicatorId: "macd",
    output: "hist",
    derive: "last",
    unit: "",
  },
  {
    id: "emaDist",
    label: "Écart prix/EMA",
    indicatorId: "ema",
    output: "ema",
    paramKey: "length",
    defaultParam: 20,
    derive: "distPct",
    unit: "%",
  },
];

/** Résout un champ indicateur par son id. */
export function getIndicatorField(id: string): IndicatorFieldSpec | undefined {
  return INDICATOR_FIELDS.find((f) => f.id === id);
}

/** Une condition indicateur : `champ(param) op valeur`, évaluée sur le TF du run. */
export interface IndicatorCondition {
  kind: "indicator";
  fieldId: string;
  /** surcharge du paramètre principal (ex. length) ; défaut si absent. */
  param?: number;
  op: Operator;
  value: number;
}

export type ScreenerCondition = BaseCondition | IndicatorCondition;

// ─────────────────────────── Évaluation des filtres de base ───────────────────────────

/** Applique un opérateur de comparaison. PURE. */
export function compareOp(a: number, op: Operator, b: number): boolean {
  switch (op) {
    case ">":
      return a > b;
    case ">=":
      return a >= b;
    case "<":
      return a < b;
    case "<=":
      return a <= b;
  }
}

/** Valeur d'un champ de base pour une ligne (undefined si non renseigné, ex. funding absent). */
export function baseFieldValue(row: ScreenerRow, field: BaseField): number | undefined {
  switch (field) {
    case "volumeUsd24h":
      return row.volumeUsd24h;
    case "priceChangePct24h":
      return row.priceChangePct24h;
    case "absPriceChangePct24h":
      return Math.abs(row.priceChangePct24h);
    case "lastPrice":
      return row.lastPrice;
    case "fundingPct":
      return row.fundingPct;
  }
}

/**
 * Évalue une condition de base. Un champ non renseigné (ex. filtre funding sur un
 * symbole sans perp) échoue la condition : un screen funding restreint donc de fait
 * l'univers aux perpétuels. PURE.
 */
export function evalBaseCondition(row: ScreenerRow, cond: BaseCondition): boolean {
  const v = baseFieldValue(row, cond.field);
  if (v === undefined || !Number.isFinite(v)) return false;
  return compareOp(v, cond.op, cond.value);
}

/** Ne conserve que les lignes satisfaisant TOUTES les conditions de base. PURE. */
export function applyBaseFilters(rows: ScreenerRow[], conditions: BaseCondition[]): ScreenerRow[] {
  if (conditions.length === 0) return rows.slice();
  return rows.filter((row) => conditions.every((c) => evalBaseCondition(row, c)));
}

/**
 * Sélectionne les candidats de l'étage indicateurs : trie par volume DÉCROISSANT
 * (les plus liquides d'abord, les plus pertinents) puis coupe au plafond. PURE.
 */
export function selectCandidates(rows: ScreenerRow[], cap: number = SCREENER_CAP): ScreenerRow[] {
  return [...rows].sort((a, b) => b.volumeUsd24h - a.volumeUsd24h).slice(0, cap);
}

// ─────────────────────────── Dérivation d'un scalaire indicateur ───────────────────────────

/** Dernière valeur définie et finie d'une série (undefined si aucune). PURE. */
export function lastDefined(series: ReadonlyArray<number | undefined>): number | undefined {
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (v !== undefined && Number.isFinite(v)) return v;
  }
  return undefined;
}

/**
 * Dérive le scalaire comparé d'un champ indicateur à partir de sa série de sortie :
 *  - "last"    : dernière valeur définie ;
 *  - "distPct" : 100·(close − valeur)/valeur (écart signé du prix à l'indicateur).
 * Renvoie undefined si la série est vide ou le dernier close manquant. PURE.
 */
export function deriveScalar(
  spec: IndicatorFieldSpec,
  series: ReadonlyArray<number | undefined>,
  lastClose: number | undefined,
): number | undefined {
  const v = lastDefined(series);
  if (v === undefined) return undefined;
  if (spec.derive === "distPct") {
    if (lastClose === undefined || !Number.isFinite(lastClose) || v === 0) return undefined;
    return (100 * (lastClose - v)) / v;
  }
  return v;
}

/** Dernier close (fini) d'un tableau de bougies. PURE. */
export function lastClose(candles: Candle[]): number | undefined {
  const last = candles[candles.length - 1];
  return last !== undefined && Number.isFinite(last.close) ? last.close : undefined;
}

/** Libellé compact d'une condition indicateur pour l'affichage (« RSI(14) »). */
export function indicatorConditionLabel(cond: IndicatorCondition): string {
  const spec = getIndicatorField(cond.fieldId);
  if (spec === undefined) return cond.fieldId;
  const p = cond.param ?? spec.defaultParam;
  return spec.paramKey !== undefined && p !== undefined ? `${spec.label}(${p})` : spec.label;
}

// ─────────────────────────── Presets préconfigurés ───────────────────────────

/** Un preset de screener : TF + conditions de base + conditions indicateurs. */
export interface ScreenerPreset {
  id: string;
  name: string;
  tf: Timeframe;
  baseConditions: BaseCondition[];
  indicatorConditions: IndicatorCondition[];
  /** true pour les presets livrés (non supprimables) ; absent pour ceux de l'utilisateur. */
  builtin?: boolean;
}

/**
 * Presets livrés. Un plancher de volume écarte les paires illiquides (résultats plus
 * exploitables). « Survendu 4h » = RSI < 30 ; « Volume anormal » = très gros volume ;
 * « Funding négatif » = funding < 0 (biais short payé, restreint aux perps).
 */
export const BUILTIN_PRESETS: ScreenerPreset[] = [
  {
    id: "builtin:survendu-4h",
    name: "Survendu 4h",
    tf: "4h",
    baseConditions: [{ kind: "base", field: "volumeUsd24h", op: ">", value: 5_000_000 }],
    indicatorConditions: [{ kind: "indicator", fieldId: "rsi", param: 14, op: "<", value: 30 }],
    builtin: true,
  },
  {
    id: "builtin:volume-anormal",
    name: "Volume anormal",
    tf: "1h",
    baseConditions: [{ kind: "base", field: "volumeUsd24h", op: ">", value: 100_000_000 }],
    indicatorConditions: [],
    builtin: true,
  },
  {
    id: "builtin:funding-negatif",
    name: "Funding négatif",
    tf: "1h",
    baseConditions: [
      { kind: "base", field: "fundingPct", op: "<", value: 0 },
      { kind: "base", field: "volumeUsd24h", op: ">", value: 10_000_000 },
    ],
    indicatorConditions: [],
    builtin: true,
  },
];
