/**
 * Découpage de symbole partagé (Kraken, Coinbase) — deux formats d'ENTRÉE acceptés :
 *  - CONCATÉNÉ style Binance (ex. "BTCUSDT", "ETHUSD", "BTCJPY") : on repère le suffixe
 *    de devise de cotation reconnu le plus LONG d'abord (ex. "USDT" avant "USD") ;
 *  - EXPLICITE "BASE/QUOTE" avec slash (ex. Kraken WS "XBT/USD") : découpe directe sur
 *    le slash, sans deviner la cotation.
 */

/**
 * Devises de cotation reconnues (format concaténé). Couvre les catalogues réels de
 * Kraken/Coinbase (cf. data/pairs.ts) : stablecoins (USDT/USDC/USDD/TUSD/USDE/EURC/DAI),
 * fiat (USD/EUR/GBP/JPY/CHF/CAD/AUD/TRY/BRL) et cryptos servant de cotation (BTC/ETH).
 * TRIÉ par longueur DÉCROISSANTE au chargement : garantit qu'un suffixe long est essayé
 * avant un suffixe plus court qui en est une terminaison. Ex. "TUSD" (TrueUSD) se termine
 * par "USD" : sans le tri, "FOOTUSD" serait découpé à tort en base "FOOT" / quote "USD"
 * au lieu de base "FOO" / quote "TUSD".
 */
export const QUOTE_ASSETS = [
  // Stablecoins / cotations crypto (5 et 4 caractères ; FDUSD et TUSD selon la place, cf. splitSymbol)
  "FDUSD", "USDT", "USDC", "USDD", "TUSD", "USDE", "EURC",
  // Fiat + stablecoin 3 lettres + cryptos de cotation
  "DAI", "USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "TRY", "BRL", "BTC", "ETH",
].sort((a, b) => b.length - a.length);

/**
 * Découpe un symbole en { base, quote }.
 *  - "XBT/USD"  -> { base: "XBT", quote: "USD" }  (format à slash)
 *  - "BTCUSDT"  -> { base: "BTC", quote: "USDT" } (suffixe de cotation le plus long)
 * @throws si le format est invalide (slash bordé de vide) ou la cotation inconnue.
 */
export function splitSymbol(symbol: string, exchangeLabel: string): { base: string; quote: string } {
  const s = symbol.toUpperCase();

  // Format explicite "BASE/QUOTE" (ex. Kraken WS "XBT/USD") : découpe directe sur le slash.
  const slash = s.indexOf("/");
  if (slash >= 0) {
    const base = s.slice(0, slash);
    const quote = s.slice(slash + 1);
    if (base.length === 0 || quote.length === 0) {
      throw new Error(`${exchangeLabel}: format de symbole invalide '${symbol}' (base ou cotation vide)`);
    }
    return { base, quote };
  }

  // Format concaténé : suffixe de cotation reconnu, le plus LONG d'abord (cf. tri ci-dessus).
  // FDUSD n'est une cotation que chez Binance (WFDUSD = W/FDUSD ; UFD/USD de Kraken reste UFD /
  // USD). TUSD l'est partout sauf chez Kraken, Coinbase, OKX et Bybit, qui n'en cotent pas :
  // DOT/USD (« DOTUSD ») y reste DOT / USD. Sans place connue, comportement historique.
  const binance = /binance/i.test(exchangeLabel);
  const sansTusd = /kraken|coinbase|okx|bybit/i.test(exchangeLabel);
  const quote = QUOTE_ASSETS.find((q) => s.endsWith(q) && s.length > q.length
    && (q !== "FDUSD" || binance) && (q !== "TUSD" || !sansTusd));
  if (quote === undefined) {
    throw new Error(`${exchangeLabel}: format de symbole inattendu '${symbol}' (devise de cotation inconnue)`);
  }
  return { base: s.slice(0, s.length - quote.length), quote };
}

/** Cotations assimilées au dollar : USD et stablecoins USD (1 stablecoin compté pour 1 USD). */
export const COTATIONS_USD: readonly string[] = ["USD", "USDT", "USDC", "FDUSD", "USDD", "TUSD", "USDE", "DAI"];

/** Alias d'actif propres à un exchange → ticker canonique (Kraken code le bitcoin « XBT »). */
const ALIAS_BASE: Record<string, string> = { XBT: "BTC" };

/**
 * Base CANONIQUE d'un symbole, quel que soit le format d'exchange — pensée pour les sources
 * qui ne connaissent QUE le perp Binance (`<base>USDT` : Coinalyze, openInterestHist).
 *
 * `splitSymbol` ne suffit pas : il ignore le séparateur TIRET de Coinbase (« BTC-USD » y
 * donnerait la base « BTC- », d'où l'OI muet hors perp Binance) et rend l'alias Kraken « XBT »
 * tel quel. On ajoute donc un helper SÉPARÉ plutôt que d'élargir `splitSymbol` (34 appelants).
 *
 *  - « BTC-USD » / « XBT/USD » / « BTCUSDT » → « BTC » ;
 *  - symbole SYNTHÉTIQUE (encodage `exA:LEGA|op|exB:LEGB`, cf. data/synthetic.ts) → `null` :
 *    il n'a pas d'actif sous-jacent unique ;
 *  - cotation inconnue / base vide ou non alphanumérique → `null` (l'appelant renonce au fetch).
 * `place` (facultative) : sans elle, FDUSD n'est pas une cotation et TUSD l'est (cf. splitSymbol).
 */
export function basePerp(symbol: string, place = "basePerp"): string | null {
  const s = symbol.trim().toUpperCase();
  if (s.length === 0 || s.includes("|")) return null; // vide ou synthétique

  if (s.endsWith("-PERP")) {
    const coin = s.slice(0, -5);
    return /^[A-Z0-9]{2,20}$/.test(coin) ? (ALIAS_BASE[coin] ?? coin) : null;
  }

  // Tiret Coinbase ramené au séparateur explicite déjà géré par splitSymbol.
  const normalise = s.replace("-", "/");
  let base: string;
  try {
    base = splitSymbol(normalise, place).base;
  } catch {
    return null; // cotation inconnue / côté vide → inextricable
  }
  if (!/^[A-Z0-9]{2,10}$/.test(base)) return null;
  return ALIAS_BASE[base] ?? base;
}


/** Conserve la casse native des coins HL (ex. kPEPE), issue du catalogue public. */
const COINS_HL = new Map<string, string>();
export function registerHyperliquidCoin(coin: string): void { COINS_HL.set(coin.toUpperCase(), coin); }
export function hyperliquidCoin(symbol: string): string {
  const coin = symbol.toUpperCase().endsWith("-PERP") ? symbol.slice(0, -5) : splitSymbol(symbol, "Hyperliquid").base;
  return COINS_HL.get(coin.toUpperCase()) ?? coin;
}
