/**
 * Mapping PUR des toggles de ratio « ÷DENOM » : marché courant ⇄ ratio synthétique X/DENOM.
 * Zéro import React/store — le moteur SYN (data/synthetic.ts) fait tout le reste
 * (live, AT). Détoggle SANS ÉTAT : quitter un ratio = revenir à sa jambe A.
 *
 * Trois familles de dénominateurs (demande du 26/09/2026) :
 *  - crypto (BTC, ETH, SOL) : réf locale de la source quand elle existe, sinon réf
 *    canonique Binance (cross-source, lot D) ;
 *  - marchés (or, Nasdaq 100, S&P 500) et devises (EUR, GBP, CHF, JPY, CAD, AUD) : une
 *    jambe Twelve Data UNIQUE, quelle que soit la source de l'actif. Réservés aux actifs
 *    cotés en dollar (USD, USDT, USDC, FDUSD — stablecoin ≈ USD) : diviser BTCEUR par
 *    XAU/USD mélangerait deux devises. Une devise s'exprime par sa paire CCY/USD : BTC en
 *    CHF = BTCUSDT ÷ CHF/USD.
 * Deux notions à ne jamais confondre :
 *  - le ratio ACTIF se déduit du SYMBOLE seul (`estRatio`, sans état) — il décide quel
 *    bouton s'affiche actif et vers quelle jambe on revient ;
 *  - le dénominateur CHOISI est une préférence persistée (store/denominateur.ts) qui ne
 *    pilote que le libellé et l'action du bouton scindé.
 *
 * CROSS-SOURCE (lot D) : une source SANS réf locale mais dont les jambes sont acceptées
 * par le moteur SYN (twelvedata) se compose contre la RÉFÉRENCE CANONIQUE Binance
 * (`REF_CANONIQUE`) — ex. or ÷ BTC = `twelvedata:GLD|/|binance:BTCUSDT`. `estRatio`
 * reconnaît symétriquement une jambe B sur un AUTRE exchange que la jambe A, à condition
 * qu'elle soit exactement la réf canonique de SON exchange. Les SYN composés restent
 * exclus comme jambes ; les séries autonomes TOTAL* passent par la jambe virtuelle `mcap`.
 */
import type { ExchangeId } from "@axiom/types";
import { encodeSyntheticSymbol, parseSyntheticSymbol, type SyntheticLegSource, type SyntheticSpec } from "./synthetic";
import { estSymboleCapitalisation } from "./mcap";
import { basePerp, splitSymbol } from "./symbol";

export const DENOMINATEURS_CRYPTO = ["BTC", "ETH", "SOL"] as const;
export const DENOMINATEURS_MARCHES = ["OR", "NASDAQ", "SP500"] as const;
export const DENOMINATEURS_DEVISES = ["EUR", "GBP", "CHF", "JPY", "CAD", "AUD"] as const;
/** Dénominateurs proposés par les toggles de ratio, dans l'ordre d'affichage. */
export const DENOMINATEURS = [...DENOMINATEURS_CRYPTO, ...DENOMINATEURS_MARCHES, ...DENOMINATEURS_DEVISES] as const;
export type DenominateurId = (typeof DENOMINATEURS)[number];
type DenominateurCrypto = (typeof DENOMINATEURS_CRYPTO)[number];
type DenominateurTradfi = Exclude<DenominateurId, DenominateurCrypto>;

/**
 * Ticker de référence par dénominateur crypto et par source jambe (catalogues normalisés
 * format Binance ; perps Hyperliquid en `-PERP`). Un couple (dénominateur, source) ABSENT
 * rend le ratio non composable (hors cross-source) : le bouton disparaît plutôt que
 * d'émettre un SYN dont une jambe n'existe pas.
 */
export const REFS: Record<DenominateurCrypto, Partial<Record<ExchangeId, string>>> = {
  BTC: { binance: "BTCUSDT", mexc: "BTCUSDT", bybit: "BTCUSDT", okx: "BTCUSDT", kraken: "BTCUSD", coinbase: "BTCUSD", hyperliquid: "BTC-PERP" },
  ETH: { binance: "ETHUSDT", mexc: "ETHUSDT", bybit: "ETHUSDT", okx: "ETHUSDT", kraken: "ETHUSD", coinbase: "ETHUSD", hyperliquid: "ETH-PERP" },
  SOL: { binance: "SOLUSDT", mexc: "SOLUSDT", bybit: "SOLUSDT", okx: "SOLUSDT", kraken: "SOLUSD", coinbase: "SOLUSD", hyperliquid: "SOL-PERP" },
};

/**
 * Référence CANONIQUE cross-source par dénominateur crypto : la jambe B posée quand la
 * source courante n'a PAS de réf locale (tradfi ÷ crypto). Binance spot, comme les réfs
 * des indicateurs statistiques (store/refSymbol.ts) — la paire la plus liquide, toujours
 * listée, 24/7 (la jambe crypto ne crée jamais de trous face au forward-fill tradfi).
 */
export const REF_CANONIQUE: Record<DenominateurCrypto, { ex: "binance"; sym: string }> = {
  BTC: { ex: "binance", sym: "BTCUSDT" },
  ETH: { ex: "binance", sym: "ETHUSDT" },
  SOL: { ex: "binance", sym: "SOLUSDT" },
};

/**
 * Jambe Twelve Data des dénominateurs marchés et devises, vérifiée sur l'offre du
 * propriétaire le 26/09/2026 : XAU/USD, EUR/USD, CHF/USD, JPY/USD, CAD/USD servis ; les
 * indices SPX et NDX exigent l'offre Grow — le S&P 500 et le Nasdaq 100 passent donc par
 * leurs ETF SPY et QQQ, NOMMÉS dans le libellé (jamais une substitution silencieuse).
 */
export const REFS_TRADFI: Record<DenominateurTradfi, { sym: string; libelle: string; detail: string }> = {
  OR: { sym: "XAU/USD", libelle: "÷Or", detail: "l'or spot (XAU/USD, en onces)" },
  NASDAQ: { sym: "QQQ", libelle: "÷Nasdaq 100 (QQQ)", detail: "le Nasdaq 100 via l'ETF QQQ (l'indice NDX exige l'offre Grow de Twelve Data)" },
  SP500: { sym: "SPY", libelle: "÷S&P 500 (SPY)", detail: "le S&P 500 via l'ETF SPY (l'indice SPX exige l'offre Grow de Twelve Data)" },
  EUR: { sym: "EUR/USD", libelle: "en EUR", detail: "l'euro (÷ EUR/USD)" },
  GBP: { sym: "GBP/USD", libelle: "en GBP", detail: "la livre sterling (÷ GBP/USD)" },
  CHF: { sym: "CHF/USD", libelle: "en CHF", detail: "le franc suisse (÷ CHF/USD)" },
  JPY: { sym: "JPY/USD", libelle: "en JPY", detail: "le yen (÷ JPY/USD)" },
  CAD: { sym: "CAD/USD", libelle: "en CAD", detail: "le dollar canadien (÷ CAD/USD)" },
  AUD: { sym: "AUD/USD", libelle: "en AUD", detail: "le dollar australien (÷ AUD/USD)" },
};

const estCrypto = (denom: DenominateurId): denom is DenominateurCrypto =>
  (DENOMINATEURS_CRYPTO as readonly string[]).includes(denom);

/** Libellé du bouton : « ÷BTC », « ÷Or », « ÷S&P 500 (SPY) », « en CHF ». */
export function libelleDenominateur(denom: DenominateurId): string {
  return estCrypto(denom) ? `÷${denom}` : REFS_TRADFI[denom].libelle;
}

/** Infobulle : ce que divise réellement le ratio. */
export function detailDenominateur(denom: DenominateurId): string {
  return estCrypto(denom) ? denom : REFS_TRADFI[denom].detail;
}

/** Base/cotation d'un symbole de source crypto ; les perps Hyperliquid sont en USD. */
function decouper(symbol: string, exchange: ExchangeId): { base: string; quote: string } | null {
  if (exchange === "hyperliquid") {
    const base = basePerp(symbol);
    return base === null ? null : { base, quote: "USD" };
  }
  try {
    return splitSymbol(symbol, exchange);
  } catch {
    return null;
  }
}

const COTATIONS_DOLLAR = ["USD", "USDT", "USDC", "FDUSD"];

/**
 * Ratio ÷ marché ou devise : jambe B Twelve Data unique. Actifs cotés en dollar seulement
 * (capitalisations TOTAL* en USD, tickers Twelve Data sans barre = valeurs US, paires
 * X/USD) ; jamais l'actif divisé par lui-même ou par sa propre devise (EURUSDT en EUR).
 */
function symboleRatioTradfi(symbol: string, exchange: ExchangeId, denom: DenominateurTradfi): string | null {
  const ref = REFS_TRADFI[denom].sym;
  let exA: SyntheticLegSource;
  if (exchange === "synthetic") {
    if (!estSymboleCapitalisation(symbol)) return null;
    exA = "mcap";
  } else if (exchange === "twelvedata") {
    const [base, quote] = symbol.toUpperCase().split("/");
    if (symbol === ref || base === denom || (quote !== undefined && quote !== "USD")) return null;
    exA = exchange;
  } else {
    const parts = decouper(symbol, exchange);
    if (parts === null || parts.base === denom || !COTATIONS_DOLLAR.includes(parts.quote)) return null;
    exA = exchange;
  }
  return encodeSyntheticSymbol({ exA, legA: symbol, exB: "twelvedata", legB: ref, op: "/" });
}

/**
 * Symbole SYN du ratio X/DENOM pour le marché courant, ou null si non basculable :
 * SYN déjà composé (les TOTAL* autonomes sont l'exception), source sans réf ni composition
 * cross-source, base déjà égale au dénominateur, cotation déjà dans le dénominateur
 * (ex. ETHBTC ÷BTC), ou symbole non découpable (splitSymbol throw). Marchés et devises :
 * cf. `symboleRatioTradfi`.
 *
 * Crypto : même source quand `REFS[denom][exchange]` existe (comportement historique, inchangé) ;
 * sinon, twelvedata compose CROSS-SOURCE contre la réf canonique Binance — SANS
 * splitSymbol (un ticker tradfi comme SPY ou GLD n'est pas découpable), mais AVEC une
 * garde sur les paires à barre oblique : l'API Twelve Data cote aussi des paires
 * crypto (BTC/USD, ETH/BTC…) en saisie libre — si une jambe de la paire EST le
 * dénominateur, le ratio serait un SYN mort (≈ constante 1) ou une double division.
 */
export function symboleRatio(
  symbol: string,
  exchange: ExchangeId,
  denom: DenominateurId,
): string | null {
  if (!estCrypto(denom)) return symboleRatioTradfi(symbol, exchange, denom);
  // Garde `synthetic` EN PREMIER : seul un TOTAL* autonome devient une jambe `mcap` ;
  // un SYN déjà encodé ne doit JAMAIS être imbriqué comme nouvelle jambe.
  if (exchange === "synthetic") {
    if (!estSymboleCapitalisation(symbol)) return null;
    const canon = REF_CANONIQUE[denom];
    return encodeSyntheticSymbol({
      exA: "mcap",
      legA: symbol,
      exB: canon.ex,
      legB: canon.sym,
      op: "/",
    });
  }

  const ref = REFS[denom][exchange];
  if (ref === undefined) {
    // Pas de réf locale : seule twelvedata se compose cross-source (réf canonique).
    if (exchange !== "twelvedata") return null;
    // Garde paires crypto en saisie libre (BTC/USD, ETH/BTC…) : une jambe qui
    // EST le dénominateur rend le ratio sans signification — bouton absent.
    const jambes = symbol.split("/");
    if (jambes.length > 1 && jambes.some((j) => j.trim().toUpperCase() === denom)) return null;
    const canon = REF_CANONIQUE[denom];
    return encodeSyntheticSymbol({
      exA: exchange,
      legA: symbol,
      exB: canon.ex,
      legB: canon.sym,
      op: "/",
    });
  }

  const parts = decouper(symbol, exchange);
  if (parts === null || parts.base === denom || parts.quote === denom) return null;

  return encodeSyntheticSymbol({ exA: exchange, legA: symbol, exB: exchange, legB: ref, op: "/" });
}

/** Ratio actif posé par un toggle, avec le dénominateur reconnu. */
export interface RatioActif {
  spec: SyntheticSpec;
  denom: DenominateurId;
}

/**
 * Ratio ÷DENOM actif si le marché courant EST un ratio posé par un toggle
 * (exchange="synthetic", op="/", jambe B = réf du dénominateur), sinon null.
 * Le dénominateur renvoyé est celui dont la réf correspond à la jambe B.
 *
 * La jambe B est TOUJOURS vérifiée contre la réf de SON exchange (spec.exB, jamais
 * celle de exA — sinon un SYN quelconque à legB « BTCUSD » serait faussement reconnu) :
 *  - même source (exB === exA) : réf locale `REFS[denom][exB]` ;
 *  - cross-source (exB !== exA, lot D) : exactement la réf canonique
 *    (`exB === REF_CANONIQUE[denom].ex` ET `legB === REF_CANONIQUE[denom].sym`) ;
 *  - marchés et devises : jambe B Twelve Data égale à `REFS_TRADFI[denom].sym`.
 */
export function estRatio(symbol: string, exchange: ExchangeId): RatioActif | null {
  if (exchange !== "synthetic") return null;
  const spec = parseSyntheticSymbol(symbol);
  if (spec === null) return null;
  const exB = spec.exB;
  if (spec.op !== "/" || exB === "mcap") return null;
  const denom = DENOMINATEURS.find((d) =>
    !estCrypto(d)
      ? exB === "twelvedata" && spec.legB === REFS_TRADFI[d].sym
      : exB === spec.exA
        ? spec.legB === REFS[d][exB]
        : exB === REF_CANONIQUE[d].ex && spec.legB === REF_CANONIQUE[d].sym,
  );
  return denom === undefined ? null : { spec, denom };
}
