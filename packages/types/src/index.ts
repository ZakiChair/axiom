/**
 * @axiom/types — Contrat de données partagé de toute la plateforme.
 *
 * Source de vérité unique (§5 de la spec). Tout package/app consomme ces types ;
 * aucune donnée brute d'exchange ne circule sans passer par cette normalisation.
 *
 * Build PERSO mono-utilisateur — crypto d'abord (spot + perp), tradfi/commodités plus tard.
 */

// ---------- Temps & symboles ----------
export type Timeframe =
  | "1s" | "5s" | "15s"
  | "1m" | "3m" | "5m" | "15m" | "30m"
  | "1h" | "2h" | "4h" | "6h" | "12h"
  | "1d" | "3d" | "1w" | "1M"
  // Trimestriel / semestriel / annuel : non natifs chez la plupart des exchanges,
  // agrégés côté client depuis le mensuel (1M). Convention : "M" = mois.
  | "3M" | "6M" | "12M";

export type ExchangeId =
  | "binance"
  | "bybit"
  | "okx"
  // Hyperliquid : DEX de perpétuels margés USDC, marchés désignés par nom de coin.
  | "hyperliquid"
  | "coinbase"
  | "kraken"
  // Source MARCHÉS TRADITIONNELS (actions, forex ; indices & commodités via ETF) —
  // Twelve Data (API à clé). Bougies OHLC ; polling (pas de WS gratuit) ; pas de tick.
  | "twelvedata"
  // Exchange crypto MEXC (spot v3, keyless) — inclut des ACTIONS TOKENISÉES
  // (AAPLXUSDT, TSLAONUSDT…). Klines via proxy ; polling REST (WS spot = protobuf).
  | "mexc"
  // Source VIRTUELLE : séries synthétiques ratio/spread à 2 jambes composées
  // client-side (data/synthetic.ts). Jamais une jambe elle-même.
  | "synthetic";

export type MarketType = "spot" | "perp" | "futures" | "option";

export interface SymbolInfo {
  symbol: string; // ex. "BTCUSDT"
  base: string; // "BTC"
  quote: string; // "USDT"
  exchange: ExchangeId;
  marketType: MarketType;
  pricePrecision: number;
  qtyPrecision: number;
  tickSize: number;
  /** perp/futures : taille de contrat (notionnel) ; absent en spot. */
  contractSize?: number;
  /** perp/futures : true pour les contrats inverses (coin-margined). */
  inverse?: boolean;
}

// ---------- OHLCV ----------
export interface Candle {
  time: number; // ms epoch (open time)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // volume en base
  quoteVolume?: number;
  /** volume agressif acheteur (pour delta/footprint). */
  buyVolume?: number;
  sellVolume?: number;
  /** nombre de trades dans la bougie. */
  trades?: number;
  /** true tant que la bougie n'est pas clôturée (live). */
  closed?: boolean;
}

// ---------- Trades (tick) ----------
export interface Trade {
  time: number;
  price: number;
  qty: number;
  /** côté de l'agresseur (taker). */
  side: "buy" | "sell";
  isLiquidation?: boolean;
}

// ---------- Orderbook ----------
/** [price, size] ; size=0 => suppression du niveau dans un delta. */
export type PriceLevel = [price: number, size: number];

export interface OrderBook {
  time: number;
  bids: PriceLevel[]; // tri décroissant
  asks: PriceLevel[]; // tri croissant
  lastUpdateId?: number;
}

export interface OrderBookDelta {
  time: number;
  bids: PriceLevel[];
  asks: PriceLevel[];
  firstUpdateId?: number;
  finalUpdateId?: number;
}

// ---------- Métriques dérivés ----------
export interface OpenInterest {
  time: number;
  symbol: string;
  oi: number;
  oiUsd: number;
}

export interface FundingRate {
  time: number;
  symbol: string;
  rate: number;
  nextFundingTime: number;
  markPrice: number;
  /** intervalle natif en ms (8h classique, parfois 4h/1h) — requis pour agréger correctement. */
  intervalMs?: number;
}

export interface LongShortRatio {
  time: number;
  symbol: string;
  longAccount: number;
  shortAccount: number;
  ratio: number;
  type: "account" | "position" | "topTrader";
}

export interface Liquidation {
  time: number;
  symbol: string;
  side: "long" | "short";
  price: number;
  qty: number;
  qtyUsd: number;
}

export interface MarkPrice {
  time: number;
  symbol: string;
  markPrice: number;
  indexPrice: number;
}

/** ex. Coinbase Premium — exprimé en % de préférence (voir critique §7 consistency). */
export interface PremiumPoint {
  time: number;
  symbol: string;
  premium: number;
}

// ---------- Footprint / profil ----------
export interface FootprintRow {
  price: number;
  buyVol: number;
  sellVol: number;
}

export interface FootprintBar {
  time: number;
  rows: FootprintRow[];
  poc: number; // Point of Control
  vah: number; // Value Area High
  val: number; // Value Area Low
  delta: number; // Σ(buy - sell)
  cumulativeDelta?: number;
}

export interface VolumeProfileBin {
  price: number;
  volume: number;
  buyVol: number;
  sellVol: number;
}

// ---------- Séries auxiliaires (contrat pour indicateurs dérivés on-chain/derivs) ----------
/** Identifiant d'une série auxiliaire fournie par l'appelant (jamais fetchée par le moteur). */
export type AuxSeriesId = "oi" | "funding" | "mark" | "stablecoins" | "nvt" | "mvrv" | "marketcap";

/**
 * Séries auxiliaires DÉJÀ alignées sur les bougies (même longueur, même index).
 * Fournies par l'appelant (ex. `AuxProvider`, Task 12) — le moteur `@axiom/indicators`
 * reste pur et synchrone : aucun fetch, aucun accès réseau/DOM.
 */
export type AuxSeries = Partial<Record<AuxSeriesId, Array<number | undefined>>>;

// ---------- Indicateurs ----------
export type IndicatorCategory =
  | "trend"
  | "momentum"
  | "volatility"
  | "volume"
  | "orderflow"
  | "billwilliams"
  | "support_resistance"
  | "derivatives"
  | "custom";

export type IndicatorPane = "overlay" | "separate";

export type PlotStyle = "line" | "histogram" | "area" | "band" | "points";

/** Un paramètre configurable d'un indicateur. */
export interface IndicatorInput {
  key: string;
  name: string;
  type: "number" | "boolean" | "source" | "select";
  default: number | boolean | string;
  min?: number;
  max?: number;
  options?: string[];
}

/** Une série de sortie + son style de rendu déclaratif. */
export interface IndicatorOutput {
  key: string;
  name: string;
  style: PlotStyle;
  color?: string;
}

/** Résultat de calcul : une série de valeurs par clé de sortie, alignée sur les bougies. */
export interface IndicatorResult {
  /** clé d'output -> valeurs (NaN/undefined pour les bougies sans valeur). */
  series: Record<string, Array<number | undefined>>;
}

/** Contexte fourni au calcul (sources dérivées, accès aux barres précédentes pour l'incrémental). */
export interface CalcContext {
  hl2: number[];
  hlc3: number[];
  ohlc4: number[];
  /** Série résolue selon `params.source` (défaut "close") : la série mono-prix que les defs doivent lire. */
  source: number[];
  /** Séries auxiliaires pré-alignées sur les bougies (fournies par l'appelant, voir `AuxSeries`). */
  aux?: AuxSeries;
}

/** Définition déclarative d'un indicateur. Le moteur ne connaît que cette interface. */
export interface IndicatorDef {
  id: string;
  name: string;
  category: IndicatorCategory;
  pane: IndicatorPane;
  inputs: IndicatorInput[];
  outputs: IndicatorOutput[];
  /** Séries auxiliaires requises par ce def (ex. ["oi", "funding"]) — déclaratif, résolu par l'appelant. */
  aux?: AuxSeriesId[];
  /**
   * Précision d'affichage (décimales) de l'axe/légende du pane, quand elle diffère de la
   * valeur par défaut de KLineChart (4). Ex. 2 pour un oscillateur borné 0-100 (RSI) afin
   * d'éviter « 66.0000 ». Non fixée => précision par défaut du moteur de graphe (audit #9).
   */
  precision?: number;
  /** Timeframe minimal en dessous duquel ce def n'est pas pertinent (ex. données on-chain journalières). */
  minTimeframe?: Timeframe;
  calc: (
    candles: Candle[],
    params: Record<string, number | boolean | string>,
    ctx: CalcContext
  ) => IndicatorResult;
}

// ---------- Abstraction exchange (§4.4) ----------
export type Unsubscribe = () => void;

export interface IExchangeAdapter {
  id: ExchangeId;
  fetchKlines(symbol: string, tf: Timeframe, opts?: { limit?: number; endTime?: number }): Promise<Candle[]>;
  subscribeKline(symbol: string, tf: Timeframe, cb: (c: Candle) => void): Unsubscribe;
  subscribeTrades(symbol: string, cb: (t: Trade) => void): Unsubscribe;
}

// ---------- Abstraction fournisseur de données dérivées (Build-vs-Buy, ex. Coinalyze) ----------
export interface IDerivedDataProvider {
  id: string;
  fetchOpenInterest(symbol: string): Promise<OpenInterest>;
  fetchFundingRate(symbol: string): Promise<FundingRate>;
  fetchLongShortRatio(symbol: string, period: string): Promise<LongShortRatio>;
  fetchLiquidations(symbol: string, sinceMs: number): Promise<Liquidation[]>;
  /** Série historique d'Open Interest (pour superposition graphique). */
  fetchOpenInterestHistory(symbol: string, period: string, sinceMs: number): Promise<OpenInterest[]>;
  /** Série historique de funding rate (pour superposition graphique). */
  fetchFundingRateHistory(symbol: string, period: string, sinceMs: number): Promise<FundingRate[]>;
}

// ---------- État persistable d'un graphique (§6.5) ----------
export interface IndicatorInstance {
  defId: string;
  params: Record<string, number | boolean | string>;
}

export interface ChartState {
  symbol: string;
  exchange: ExchangeId;
  timeframe: Timeframe;
  chartType: string;
  indicators: IndicatorInstance[];
}
