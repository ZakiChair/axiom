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
 */
import type { ExchangeId } from "@axiom/types";
import { encodeSyntheticSymbol, parseSyntheticSymbol, type SyntheticSpec } from "./synthetic";
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
 * Symbole SYN du ratio X/DENOM pour le marché courant, ou null si non basculable :
 * source sans réf pour ce dénominateur (twelvedata, synthetic, non-jambe), base déjà
 * égale au dénominateur, cotation déjà dans le dénominateur (ex. ETHBTC ÷BTC), ou
 * symbole non découpable (splitSymbol throw).
 */
export function symboleRatio(
  symbol: string,
  exchange: ExchangeId,
  denom: DenominateurId,
): string | null {
  // Garde de source EN PREMIER : un SYN encodé contient un `/` que splitSymbol
  // découperait à tort sans lever — c'est cette garde qui l'écarte (réf undefined).
  const ref = REFS[denom][exchange];
  if (ref === undefined) return null;

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
 * (exchange="synthetic", op="/", exB===exA, legB===REFS[denom][exA]), sinon null.
 * Le dénominateur renvoyé est celui dont la réf correspond à la jambe B.
 */
export function estRatio(symbol: string, exchange: ExchangeId): RatioActif | null {
  if (exchange !== "synthetic") return null;
  const spec = parseSyntheticSymbol(symbol);
  if (spec === null) return null;
  if (spec.op !== "/" || spec.exB !== spec.exA) return null;
  const denom = DENOMINATEURS.find((d) => spec.legB === REFS[d][spec.exA]);
  return denom === undefined ? null : { spec, denom };
}
