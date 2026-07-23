/**
 * EQS — Screener d'actifs (logique PURE, testable hors navigateur).
 *
 * Univers : 1 requête Binance `/api/v3/ticker/24hr` (tous les symboles spot, CORS *),
 * filtrée sur les cotations USDT/USDC. Le funding des perpétuels est fusionné depuis
 * 1 requête `fapi/v1/premiumIndex` (via le proxy /extapi, fapi n'expose pas de CORS).
 *
 * Positionnement (OI Δ% / L-S) : pas d'endpoint gratuit « tous symboles » pour l'historique
 * OI ni le ratio L/S → enrichissement sur un ÉCHANTILLON des N plus liquides
 * (`SCREENER_POSITION_CAP`) via Binance `/futures/data` (1 symbole / req, CORS *).
 * La note de couverture du run affiche honnêtement le plafond (Lot B2 / G6).
 *
 * Deux étages de filtres :
 *  1. FILTRES DE BASE (sans klines) : volume 24h, |Δ24h|, prix, funding, OI Δ%, L/S —
 *     évalués ici, sur le résultat du ticker (+ enrichissement position si demandé).
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

/**
 * Plafond d'enrichissement positionnement (OI Δ% + L/S) : 2 requêtes Binance
 * `/futures/data` par symbole. N=20 → ~40 req, budget << 1000/5 min, run ≤15 s
 * (G6) avec concurrence limitée côté store.
 */
export const SCREENER_POSITION_CAP = 20;

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
  /**
   * Variation d'Open Interest en % sur la fenêtre d'historique (≈ 24 h, notionnel USD).
   * Optionnel : renseigné uniquement pour l'échantillon position (top N liquides).
   */
  oiChangePct?: number;
  /**
   * Ratio long/short des comptes globaux (Binance futures data).
   * Optionnel : même couverture échantillonnée que `oiChangePct`.
   */
  longShortRatio?: number;
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

// ─────────────────────────── Positionnement (OI Δ% / L-S) ───────────────────────────

/**
 * Δ% d'Open Interest entre le premier et le dernier point d'un historique trié
 * (notionnel USD). Renvoie undefined si < 2 points valides ou base nulle. PURE.
 */
export function oiChangePctFromHist(
  points: ReadonlyArray<{ oiUsd: number }>,
): number | undefined {
  if (points.length < 2) return undefined;
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return undefined;
  if (!Number.isFinite(first.oiUsd) || !Number.isFinite(last.oiUsd) || first.oiUsd === 0) {
    return undefined;
  }
  return (100 * (last.oiUsd - first.oiUsd)) / first.oiUsd;
}

/** Dernier ratio L/S fini d'une série triée (undefined si vide). PURE. */
export function lastLongShortRatio(
  points: ReadonlyArray<{ ratio: number }>,
): number | undefined {
  for (let i = points.length - 1; i >= 0; i--) {
    const r = points[i]?.ratio;
    if (r !== undefined && Number.isFinite(r)) return r;
  }
  return undefined;
}

/** Annote (en place) chaque ligne avec son ΔOI % si présent dans la table. PURE mutateur. */
export function applyOiChange(rows: ScreenerRow[], oiBySymbol: Map<string, number>): void {
  for (const row of rows) {
    const v = oiBySymbol.get(row.symbol);
    if (v !== undefined) row.oiChangePct = v;
  }
}

/** Annote (en place) chaque ligne avec son ratio L/S si présent dans la table. PURE mutateur. */
export function applyLongShortRatio(
  rows: ScreenerRow[],
  lsBySymbol: Map<string, number>,
): void {
  for (const row of rows) {
    const v = lsBySymbol.get(row.symbol);
    if (v !== undefined) row.longShortRatio = v;
  }
}

/** true si au moins une condition de base exige OI Δ% ou L/S (enrichissement requis). */
export function needsPositionMetrics(conditions: readonly BaseCondition[]): boolean {
  return conditions.some((c) => c.field === "oiChangePct" || c.field === "longShortRatio");
}

/**
 * Sépare les conditions de base en pré-filtres (volume, funding…) et filtres
 * position (OI/L-S) — ces derniers ne s'appliquent qu'après enrichissement. PURE.
 */
export function splitBaseConditions(conditions: readonly BaseCondition[]): {
  pre: BaseCondition[];
  position: BaseCondition[];
} {
  const pre: BaseCondition[] = [];
  const position: BaseCondition[] = [];
  for (const c of conditions) {
    if (c.field === "oiChangePct" || c.field === "longShortRatio") position.push(c);
    else pre.push(c);
  }
  return { pre, position };
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
  | "fundingPct"
  | "absFundingPct"
  | "oiChangePct"
  | "longShortRatio";

/** Métadonnées d'affichage des champs de base (ordre = ordre du sélecteur). */
export const BASE_FIELDS: { id: BaseField; label: string; unit: string }[] = [
  { id: "volumeUsd24h", label: "Volume 24h", unit: "$" },
  { id: "priceChangePct24h", label: "Δ 24h", unit: "%" },
  { id: "absPriceChangePct24h", label: "|Δ 24h|", unit: "%" },
  { id: "lastPrice", label: "Prix", unit: "" },
  { id: "fundingPct", label: "Funding", unit: "%" },
  { id: "absFundingPct", label: "|Funding|", unit: "%" },
  { id: "oiChangePct", label: "Δ OI", unit: "%" },
  { id: "longShortRatio", label: "L/S ratio", unit: "" },
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
 *  - "last"    : dernière valeur définie de la série (RSI, histogramme MACD, ADX…) ;
 *  - "distPct" : écart en % entre le dernier close et la valeur (prix vs EMA) ;
 *  - "lastPct" : dernière valeur définie × 100 (ratio brut exposé en %, ex. BB bandwidth).
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
  derive: "last" | "distPct" | "lastPct";
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
  {
    id: "adx",
    label: "ADX",
    indicatorId: "adx",
    output: "adx",
    paramKey: "length",
    defaultParam: 14,
    derive: "last",
    unit: "",
  },
  {
    id: "bbw",
    label: "BB bandwidth",
    indicatorId: "bbBandwidth",
    output: "bandwidth",
    paramKey: "length",
    defaultParam: 20,
    derive: "lastPct",
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
    case "absFundingPct":
      return row.fundingPct === undefined ? undefined : Math.abs(row.fundingPct);
    case "oiChangePct":
      return row.oiChangePct;
    case "longShortRatio":
      return row.longShortRatio;
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
 *  - "distPct" : 100·(close − valeur)/valeur (écart signé du prix à l'indicateur) ;
 *  - "lastPct" : dernière valeur définie × 100 (ratio brut exposé en %).
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
  if (spec.derive === "lastPct") return v * 100;
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
  /** Phrase expliquant la logique du scénario (affichée en `title` natif au survol). */
  description?: string;
}

/**
 * Presets livrés. Un plancher de volume écarte les paires illiquides (résultats plus
 * exploitables). « Survendu 4h » = RSI < 30 ; « Volume anormal » = très gros volume ;
 * « Funding négatif » = funding < 0 (biais short payé, restreint aux perps).
 *
 * Positionnement (B2) : crowded long/short = funding + ΔOI + L/S (échantillon top N) ;
 * funding extrême = |funding| élevé ; momentum-vol = fort |Δ24h| + volume.
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
  {
    id: "builtin:crowded-long",
    name: "Crowded long",
    tf: "1h",
    baseConditions: [
      { kind: "base", field: "volumeUsd24h", op: ">", value: 20_000_000 },
      { kind: "base", field: "fundingPct", op: ">", value: 0.01 },
      { kind: "base", field: "oiChangePct", op: ">", value: 2 },
      { kind: "base", field: "longShortRatio", op: ">", value: 1.5 },
    ],
    indicatorConditions: [],
    builtin: true,
  },
  {
    id: "builtin:crowded-short",
    name: "Crowded short",
    tf: "1h",
    baseConditions: [
      { kind: "base", field: "volumeUsd24h", op: ">", value: 20_000_000 },
      { kind: "base", field: "fundingPct", op: "<", value: -0.01 },
      { kind: "base", field: "oiChangePct", op: ">", value: 2 },
      { kind: "base", field: "longShortRatio", op: "<", value: 0.7 },
    ],
    indicatorConditions: [],
    builtin: true,
  },
  {
    id: "builtin:funding-extreme",
    name: "Funding extrême",
    tf: "1h",
    baseConditions: [
      { kind: "base", field: "volumeUsd24h", op: ">", value: 10_000_000 },
      { kind: "base", field: "absFundingPct", op: ">", value: 0.05 },
    ],
    indicatorConditions: [],
    builtin: true,
  },
  {
    id: "builtin:momentum-vol",
    name: "Momentum + volume",
    tf: "1h",
    baseConditions: [
      { kind: "base", field: "volumeUsd24h", op: ">", value: 50_000_000 },
      { kind: "base", field: "absPriceChangePct24h", op: ">", value: 5 },
    ],
    indicatorConditions: [],
    builtin: true,
  },
  // ── Presets « scénario de trade » (v1.5) : glyphe directionnel dans le nom, ──
  // ── tf 4h, description = logique reprise de la spec §2. Seuils = valeurs de ──
  // ── départ (calibrage = gate contrôleur), à ne pas « améliorer » ici. ────────
  {
    id: "builtin:long-potentiel",
    name: "▲ Long potentiel (rebond)",
    tf: "4h",
    baseConditions: [
      { kind: "base", field: "volumeUsd24h", op: ">", value: 10_000_000 },
      { kind: "base", field: "fundingPct", op: "<", value: 0 },
      { kind: "base", field: "oiChangePct", op: ">", value: 0 },
    ],
    indicatorConditions: [{ kind: "indicator", fieldId: "rsi", param: 14, op: "<", value: 35 }],
    builtin: true,
    description:
      "les shorts paient ET s'accumulent sur un actif survendu = carburant à squeeze haussier.",
  },
  {
    id: "builtin:short-potentiel",
    name: "▼ Short potentiel (euphorie)",
    tf: "4h",
    baseConditions: [
      { kind: "base", field: "volumeUsd24h", op: ">", value: 20_000_000 },
      // Calibré au gate v1.5 : 0.03 %/8 h ne laissait que ~6 symboles illiquides sur 849
      // (marché calme) → 0 candidat systématique. 0.01 = au-dessus du funding par défaut
      // Binance, même seuil que le radar SQZ et « Crowded long ».
      { kind: "base", field: "fundingPct", op: ">", value: 0.01 },
      { kind: "base", field: "oiChangePct", op: ">", value: 2 },
      { kind: "base", field: "longShortRatio", op: ">", value: 1.5 },
    ],
    indicatorConditions: [{ kind: "indicator", fieldId: "rsi", param: 14, op: ">", value: 70 }],
    builtin: true,
    description: "longs euphoriques, crowded, surachetés.",
  },
  {
    id: "builtin:range",
    name: "↔ Range / mean-reversion",
    tf: "4h",
    baseConditions: [
      { kind: "base", field: "volumeUsd24h", op: ">", value: 5_000_000 },
      { kind: "base", field: "absPriceChangePct24h", op: "<", value: 2 },
    ],
    indicatorConditions: [
      { kind: "indicator", fieldId: "adx", param: 14, op: "<", value: 20 },
      { kind: "indicator", fieldId: "bbw", param: 20, op: "<", value: 6 },
    ],
    builtin: true,
    description: "pas de tendance, volatilité contenue.",
  },
  {
    id: "builtin:compression",
    name: "◆ Compression (breakout)",
    tf: "4h",
    baseConditions: [{ kind: "base", field: "volumeUsd24h", op: ">", value: 5_000_000 }],
    // Calibré au gate v1.5 : plancher BBW > 0.3 % — sans lui les stablecoins (peg ≈ 0.04 %)
    // trustent le classement alors qu'ils ne casseront jamais.
    indicatorConditions: [
      { kind: "indicator", fieldId: "bbw", param: 20, op: "<", value: 3 },
      { kind: "indicator", fieldId: "bbw", param: 20, op: ">", value: 0.3 },
    ],
    builtin: true,
    description: "volatilité comprimée, cassure imminente, direction non préjugée.",
  },
];
