/**
 * Mapping PUR des toggles de ratio « ÷DENOM » : marché courant ⇄ ratio synthétique X/DENOM.
 * Zéro import React/store — le moteur SYN (data/synthetic.ts) fait tout le reste
 * (live, AT). Détoggle SANS ÉTAT : quitter un ratio = revenir à sa jambe A.
 *
 * Quatre familles de dénominateurs (demandes du 26/09 et du 22/11/2026) :
 *  - crypto (BTC, ETH, SOL) : réf locale de la source quand elle existe, sinon réf
 *    canonique Binance (cross-source, lot D) ;
 *  - indices (Nasdaq 100, S&P 500), matières premières (or spot, puis 13 ETF : argent,
 *    platine, palladium, cuivre, pétrole, Brent, gaz, blé, maïs, soja, sucre, panier
 *    agricole, panier large) et devises (EUR, GBP, CHF, JPY, CAD, AUD) : une
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
 * (`REF_CANONIQUE`) — ex. or ÷ BTC = `twelvedata:GLD|/|binance:BTCUSDT`.
 *
 * RECONNAISSANCE (`estRatio`) : un dénominateur fixe n'est reconnu que si le symbole se
 * recompose À L'IDENTIQUE depuis sa jambe A (`symboleRatio`) ; tout autre « / » valide — que
 * le cœur `composerRatioLibreCode` recomposerait tel quel — est un ratio LIBRE, sans id
 * (`denom: null`). Les SYN composés restent exclus comme jambes ; les séries autonomes TOTAL*
 * passent par la jambe virtuelle `mcap`.
 */
import type { ExchangeId } from "@axiom/types";
import { encodeSyntheticSymbol, parseSyntheticSymbol, type SyntheticLegSource, type SyntheticSpec } from "./synthetic";
import { estCapitalisationUsd } from "./mcap";
import { basePerp, COTATIONS_USD, splitSymbol } from "./symbol";

export const DENOMINATEURS_CRYPTO = ["BTC", "ETH", "SOL"] as const;
export const DENOMINATEURS_INDICES = ["NASDAQ", "SP500"] as const;
export const DENOMINATEURS_MATIERES = ["OR", "ARGENT", "PLATINE", "PALLADIUM", "CUIVRE", "PETROLE", "BRENT", "GAZ", "BLE", "MAIS", "SOJA", "SUCRE", "AGRICULTURE", "PANIER"] as const;
export const DENOMINATEURS_DEVISES = ["EUR", "GBP", "CHF", "JPY", "CAD", "AUD"] as const;
/** Dénominateurs proposés par les toggles de ratio, dans l'ordre d'affichage. */
export const DENOMINATEURS = [...DENOMINATEURS_CRYPTO, ...DENOMINATEURS_INDICES, ...DENOMINATEURS_MATIERES, ...DENOMINATEURS_DEVISES] as const;
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

type MatiereEtf = Exclude<(typeof DENOMINATEURS_MATIERES)[number], "OR">;
type RefTradfi = { sym: string; libelle: string; detail: string };

/**
 * Matières premières par ETF : [id, ticker, nom du libellé, nom de l'infobulle, adossé au
 * métal physique, spot refusé par l'offre]. Le libellé et l'infobulle en sont générés :
 * l'ETF est toujours NOMMÉ (jamais une substitution silencieuse au cours spot).
 */
const ETF_MATIERES: ReadonlyArray<readonly [MatiereEtf, string, string, string, boolean, string?]> = [
  ["ARGENT", "SLV", "Argent", "l'argent", true, "XAG/USD"],
  ["PLATINE", "PPLT", "Platine", "le platine", true, "XPT/USD"],
  ["PALLADIUM", "PALL", "Palladium", "le palladium", true],
  ["CUIVRE", "CPER", "Cuivre", "le cuivre", false, "HG1"],
  ["PETROLE", "USO", "Pétrole WTI", "le pétrole WTI", false, "WTI/USD"],
  ["BRENT", "BNO", "Brent", "le Brent", false, "XBR/USD"],
  ["GAZ", "UNG", "Gaz naturel", "le gaz naturel", false],
  ["BLE", "WEAT", "Blé", "le blé", false],
  ["MAIS", "CORN", "Maïs", "le maïs", false],
  ["SOJA", "SOYB", "Soja", "le soja", false],
  ["SUCRE", "CANE", "Sucre", "le sucre", false],
  ["AGRICULTURE", "DBA", "Agriculture", "un panier agricole (dont café et cacao)", false],
  ["PANIER", "DBC", "Matières premières", "un panier large (énergie, métaux, agriculture)", false],
];

const REFS_MATIERES = Object.fromEntries(ETF_MATIERES.map(([id, ticker, nom, nomInfobulle, physique, spot]) => [id, {
  sym: ticker,
  libelle: `÷${nom} (${ticker})`,
  detail: `${nomInfobulle} via l'ETF ${ticker} (prix de la part, ${physique ? "adossé au métal" : "contrats à terme renouvelés : écart possible au cours sur plusieurs années"})${spot ? ` ; le spot ${spot} exige une offre Twelve Data supérieure` : ""}`,
}])) as Record<MatiereEtf, RefTradfi>;

/**
 * Jambe Twelve Data des dénominateurs tradfi, vérifiée sur l'offre du propriétaire le
 * 26/09/2026 : XAU/USD, EUR/USD, CHF/USD, JPY/USD, CAD/USD servis ; les indices SPX et NDX
 * exigent l'offre Grow — le S&P 500 et le Nasdaq 100 passent donc par leurs ETF SPY et QQQ,
 * NOMMÉS dans le libellé. Même principe pour les matières premières (cf. `ETF_MATIERES`).
 */
export const REFS_TRADFI: Record<DenominateurTradfi, RefTradfi> = {
  ...REFS_MATIERES,
  OR: { sym: "XAU/USD", libelle: "÷Or", detail: "l'or spot (XAU/USD, en onces)" },
  NASDAQ: { sym: "QQQ", libelle: "÷Nasdaq 100 (QQQ)", detail: "le Nasdaq 100 via l'ETF QQQ : prix de l'ETF, pas le niveau de l'indice (≈ NDX/41) ; l'indice NDX exige l'offre Grow de Twelve Data" },
  SP500: { sym: "SPY", libelle: "÷S&P 500 (SPY)", detail: "le S&P 500 via l'ETF SPY : prix de l'ETF, pas le niveau de l'indice (≈ SPX/10) ; l'indice SPX exige l'offre Grow de Twelve Data" },
  EUR: { sym: "EUR/USD", libelle: "en EUR", detail: "l'euro (÷ EUR/USD)" },
  GBP: { sym: "GBP/USD", libelle: "en GBP", detail: "la livre sterling (÷ GBP/USD)" },
  CHF: { sym: "CHF/USD", libelle: "en CHF", detail: "le franc suisse (÷ CHF/USD)" },
  JPY: { sym: "JPY/USD", libelle: "en JPY", detail: "le yen (÷ JPY/USD)" },
  CAD: { sym: "CAD/USD", libelle: "en CAD", detail: "le dollar canadien (÷ CAD/USD)" },
  AUD: { sym: "AUD/USD", libelle: "en AUD", detail: "le dollar australien (÷ AUD/USD)" },
};

const estDevise = (denom: DenominateurId): boolean =>
  (DENOMINATEURS_DEVISES as readonly string[]).includes(denom);

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

const COTATIONS_DOLLAR = COTATIONS_USD;

/**
 * Ratio ÷ indice, matière première ou devise : jambe B Twelve Data unique. Actifs cotés en
 * dollar seulement (capitalisations TOTAL* en USD, tickers Twelve Data sans barre = valeurs
 * US, paires X/USD) ; jamais l'actif divisé par lui-même (CPER ÷ CPER) ou par sa propre
 * devise (EURUSDT en EUR). La dominance STABLE.D (série en %) n'est pas cotée en dollar :
 * aucun ratio.
 */
function symboleRatioTradfi(symbol: string, exchange: ExchangeId, denom: DenominateurTradfi): string | null {
  const ref = REFS_TRADFI[denom].sym;
  let exA: SyntheticLegSource;
  if (exchange === "synthetic") {
    if (!estCapitalisationUsd(symbol)) return null;
    exA = "mcap";
  } else if (exchange === "twelvedata") {
    const [base, quote] = symbol.toUpperCase().split("/");
    // « RY:TSX » : place explicite, cotation hors dollar possible — refusé.
    if (symbol === ref || symbol.includes(":") || (estDevise(denom) && base === denom) || (quote !== undefined && quote !== "USD")) return null;
    exA = exchange;
  } else {
    const parts = decouper(symbol, exchange);
    if (parts === null || (estDevise(denom) && parts.base === denom) || !COTATIONS_DOLLAR.includes(parts.quote)) return null;
    exA = exchange;
  }
  return encodeSyntheticSymbol({ exA, legA: symbol, exB: "twelvedata", legB: ref, op: "/" });
}

/**
 * Mention d'un prix coté en stablecoin compté pour 1 USD par les ratios à jambe Twelve Data
 * (indices, matières premières, devises).
 */
export function noteDollar(symbol: string, exchange: ExchangeId): string | null {
  if (exchange === "hyperliquid") return basePerp(symbol) === null ? null : "perp réglé en USDC, compté pour 1 USD";
  if (exchange === "twelvedata" || exchange === "synthetic") return null;
  const quote = decouper(symbol, exchange)?.quote;
  return quote !== undefined && quote !== "USD" && COTATIONS_DOLLAR.includes(quote) ? `${quote} compté pour 1 USD` : null;
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
  // Garde `synthetic` EN PREMIER : seul un TOTAL* autonome (en USD) devient une jambe `mcap` ;
  // un SYN déjà encodé ne doit JAMAIS être imbriqué comme nouvelle jambe, ni STABLE.D (en %).
  if (exchange === "synthetic") {
    if (!estCapitalisationUsd(symbol)) return null;
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

/** Jambe choisie dans le sélecteur « Autre actif… » : un actif du catalogue, sur sa place. */
export interface JambeChoisie { exchange: ExchangeId; symbol: string }

/**
 * Ratio libre composé, ou CODE du refus — sans texte : les messages vivent dans
 * `data/choixDiviseur.ts`, chargé avec le sélecteur, hors du chargement initial.
 */
export type CompositionLibre =
  | { symbole: string }
  | { code: "serie" | "compose" | "meme" | "devise" }
  | { code: "devises"; a: string; b: string };

/** Devise du prix, stablecoins USD comptés « USD » ; null si inconnue. PURE. */
export function deviseCotation(symbol: string, exchange: ExchangeId): string | null {
  const enDollar = (devise: string): string => (COTATIONS_DOLLAR.includes(devise) ? "USD" : devise);
  // Symbole composé (« a|/|b », « a|-|b ») : jamais une devise, quelle que soit la place annoncée.
  if (symbol.includes("|")) return null;
  if (exchange === "synthetic") return estCapitalisationUsd(symbol) ? "USD" : null;
  if (exchange === "twelvedata") {
    if (symbol.includes(":")) return null;
    const droite = symbol.split("/")[1];
    return droite === undefined ? "USD" : enDollar(droite.trim().toUpperCase());
  }
  if (exchange === "hyperliquid") return basePerp(symbol) === null ? null : "USD";
  // Format non normalisé (ex. « binance:XAU/USD ») : splitSymbol le lirait à tort en USD.
  if (symbol.includes("/")) return null;
  const parts = decouper(symbol, exchange);
  return parts === null ? null : enDollar(parts.quote);
}

/**
 * Cœur SANS TEXTE des règles 2 à 4 de la spec (§5.2), dans cet ordre : jambe B (série en % ou
 * déjà composée), base composée, A ÷ A, devise. `estRatio` (chargement initial) n'en lit que le
 * symbole ; `composerRatioLibre` (data/choixDiviseur.ts) traduit les codes en messages. PURE.
 */
export function composerRatioLibreCode(baseSym: string, baseEx: ExchangeId, jambe: JambeChoisie): CompositionLibre {
  if (jambe.exchange === "synthetic" && !estCapitalisationUsd(jambe.symbol)) return { code: "serie" };
  if (baseEx === "synthetic" && !estCapitalisationUsd(baseSym)) return { code: "compose" };
  if (baseEx === jambe.exchange && baseSym === jambe.symbol) return { code: "meme" };
  const a = deviseCotation(baseSym, baseEx);
  const b = deviseCotation(jambe.symbol, jambe.exchange);
  if (a === null || b === null) return { code: "devise" };
  if (a !== b) return { code: "devises", a, b };
  return {
    symbole: encodeSyntheticSymbol({
      exA: baseEx === "synthetic" ? "mcap" : baseEx,
      legA: baseSym,
      exB: jambe.exchange === "synthetic" ? "mcap" : jambe.exchange,
      legB: jambe.symbol,
      op: "/",
    }),
  };
}

/** Ratio actif : `denom` = dénominateur fixe recomposé exactement, `null` = ratio libre. */
export interface RatioActif {
  spec: SyntheticSpec;
  denom: DenominateurId | null;
}

/**
 * Ratio actif du symbole (sans état). FIXE : le symbole se recompose exactement par
 * `symboleRatio(jambe A, d)`. Sinon LIBRE (`denom: null`) : tout « A / B » que le cœur
 * `composerRatioLibreCode` recomposerait à l'identique. Un spread ou un ratio refusé n'est pas reconnu.
 */
export function estRatio(symbol: string, exchange: ExchangeId): RatioActif | null {
  if (exchange !== "synthetic") return null;
  const spec = parseSyntheticSymbol(symbol);
  if (spec === null || spec.op !== "/") return null;
  const exA: ExchangeId = spec.exA === "mcap" ? "synthetic" : spec.exA;
  const fixe = DENOMINATEURS.find((d) => symboleRatio(spec.legA, exA, d) === symbol);
  if (fixe !== undefined) return { spec, denom: fixe };
  const libre = composerRatioLibreCode(spec.legA, exA, { exchange: spec.exB === "mcap" ? "synthetic" : spec.exB, symbol: spec.legB });
  return "symbole" in libre && libre.symbole === symbol ? { spec, denom: null } : null;
}

/** Base de composition : jambe A du ratio (`mcap` redevient `synthetic`), sinon le marché. PURE. */
export function baseDuRatio(actif: RatioActif | null, symbol: string, exchange: ExchangeId): { symbol: string; exchange: ExchangeId } {
  if (actif === null) return { symbol, exchange };
  return { symbol: actif.spec.legA, exchange: actif.spec.exA === "mcap" ? "synthetic" : actif.spec.exA };
}

/** « BTCUSDT ÷Cuivre (CPER) », « BTCUSDT en CHF » (fixe Twelve Data), « BTCUSD ÷ BTCUSDT » (libre) ; null pour un fixe crypto (libellé SYN « A / B » conservé). PURE. */
export function libelleBandeauRatio(actif: RatioActif): string | null {
  const { denom, spec } = actif;
  if (denom === null) return `${spec.legA} ÷ ${spec.legB}`;
  return estCrypto(denom) ? null : `${spec.legA} ${libelleDenominateur(denom)}`;
}

