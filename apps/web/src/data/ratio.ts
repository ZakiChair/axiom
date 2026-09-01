/**
 * Mapping PUR des toggles de ratio « ÷DENOM » : marché courant ⇄ ratio synthétique X/DENOM.
 * Zéro import React/store — le moteur SYN (data/synthetic.ts) fait tout le reste
 * (live, AT). Détoggle SANS ÉTAT : quitter un ratio = revenir à sa jambe A.
 *
 * Généralisation du ÷BTC historique à une LISTE COURTE de dénominateurs (BTC, ETH, SOL).
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
import { encodeSyntheticSymbol, parseSyntheticSymbol, type SyntheticSpec } from "./synthetic";
import { estSymboleCapitalisation } from "./mcap";
import { splitSymbol } from "./symbol";

/** Dénominateurs proposés par les toggles de ratio, dans l'ordre d'affichage. */
export const DENOMINATEURS = ["BTC", "ETH", "SOL"] as const;
export type DenominateurId = (typeof DENOMINATEURS)[number];

/**
 * Ticker de référence par dénominateur et par source jambe (catalogues normalisés format
 * Binance). Un couple (dénominateur, source) ABSENT rend le ratio non composable : le
 * bouton disparaît plutôt que d'émettre un SYN dont une jambe n'existe pas.
 */
export const REFS: Record<DenominateurId, Partial<Record<ExchangeId, string>>> = {
  BTC: { binance: "BTCUSDT", mexc: "BTCUSDT", kraken: "BTCUSD", coinbase: "BTCUSD" },
  ETH: { binance: "ETHUSDT", mexc: "ETHUSDT", kraken: "ETHUSD", coinbase: "ETHUSD" },
  SOL: { binance: "SOLUSDT", mexc: "SOLUSDT", kraken: "SOLUSD", coinbase: "SOLUSD" },
};

/**
 * Référence CANONIQUE cross-source par dénominateur : la jambe B posée quand la source
 * courante n'a PAS de réf locale (tradfi ÷ crypto). Binance spot, comme les réfs des
 * indicateurs statistiques (store/refSymbol.ts) — la paire la plus liquide, toujours
 * listée, 24/7 (la jambe crypto ne crée jamais de trous face au forward-fill tradfi).
 */
export const REF_CANONIQUE: Record<DenominateurId, { ex: "binance"; sym: string }> = {
  BTC: { ex: "binance", sym: "BTCUSDT" },
  ETH: { ex: "binance", sym: "ETHUSDT" },
  SOL: { ex: "binance", sym: "SOLUSDT" },
};

/**
 * Symbole SYN du ratio X/DENOM pour le marché courant, ou null si non basculable :
 * SYN déjà composé (les TOTAL* autonomes sont l'exception), source sans réf ni composition
 * cross-source (bybit, okx…), base déjà égale au dénominateur, cotation déjà dans le
 * dénominateur (ex. ETHBTC ÷BTC), ou symbole non découpable (splitSymbol throw).
 *
 * Même source quand `REFS[denom][exchange]` existe (comportement historique, inchangé) ;
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

  let parts: { base: string; quote: string };
  try {
    parts = splitSymbol(symbol, exchange);
  } catch {
    return null;
  }
  if (parts.base === denom || parts.quote === denom) return null;

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
 *    (`exB === REF_CANONIQUE[denom].ex` ET `legB === REF_CANONIQUE[denom].sym`).
 */
export function estRatio(symbol: string, exchange: ExchangeId): RatioActif | null {
  if (exchange !== "synthetic") return null;
  const spec = parseSyntheticSymbol(symbol);
  if (spec === null) return null;
  const exB = spec.exB;
  if (spec.op !== "/" || exB === "mcap") return null;
  const denom = DENOMINATEURS.find((d) =>
    exB === spec.exA
      ? spec.legB === REFS[d][exB]
      : exB === REF_CANONIQUE[d].ex && spec.legB === REF_CANONIQUE[d].sym,
  );
  return denom === undefined ? null : { spec, denom };
}
